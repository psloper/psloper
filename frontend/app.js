const generateBtn = document.getElementById("generate-btn");
const printBtn = document.getElementById("print-btn");
const cancelBtn = document.getElementById("cancel-btn");
const promptEl = document.getElementById("prompt");
const generateStatus = document.getElementById("generate-status");
const printStatus = document.getElementById("print-status");
const jobIdEl = document.getElementById("job-id");
const jobStatusEl = document.getElementById("job-status");
const codeBlock = document.getElementById("code-block");
const viewerEmpty = document.getElementById("viewer-empty");
const progressWrap = document.getElementById("print-progress");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const jobListEl = document.getElementById("job-list");

let currentJobId = null;
let pollTimer = null;

// --- three.js viewer setup ---
const viewerEl = document.getElementById("viewer");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, viewerEl.clientWidth / 320, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(viewerEl.clientWidth, 320);
viewerEl.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(1, 1, 1);
scene.add(dirLight);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
let currentMesh = null;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = viewerEl.clientWidth / 320;
  camera.updateProjectionMatrix();
  renderer.setSize(viewerEl.clientWidth, 320);
});

function loadSTL(url) {
  const loader = new THREE.STLLoader();
  loader.load(url, (geometry) => {
    if (currentMesh) scene.remove(currentMesh);
    geometry.center();
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0x2f6fed, metalness: 0.1, roughness: 0.6 });
    currentMesh = new THREE.Mesh(geometry, material);
    scene.add(currentMesh);

    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere ? geometry.boundingSphere.radius : 50;
    camera.position.set(radius * 2, radius * 2, radius * 2);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();

    viewerEmpty.style.display = "none";
  });
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

async function generate() {
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  generateBtn.disabled = true;
  printBtn.disabled = true;
  setStatus(generateStatus, "Generating model with Claude (this can take up to a minute)...");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const job = await res.json();

    if (!res.ok || job.status === "error") {
      setStatus(generateStatus, job.error || "Generation failed.", "error");
      return;
    }

    currentJobId = job.id;
    jobIdEl.textContent = job.id;
    jobStatusEl.textContent = job.status;
    codeBlock.textContent = job.code || "";
    loadSTL(`/api/jobs/${job.id}/stl?t=${Date.now()}`);
    setStatus(generateStatus, "Model ready.", "ok");
    printBtn.disabled = false;
    refreshJobList();
  } catch (err) {
    setStatus(generateStatus, "Request failed: " + err.message, "error");
  } finally {
    generateBtn.disabled = false;
  }
}

async function print() {
  if (!currentJobId) return;
  printBtn.disabled = true;
  setStatus(printStatus, "Slicing model...");

  try {
    const res = await fetch(`/api/jobs/${currentJobId}/print`, { method: "POST" });
    const job = await res.json();

    if (!res.ok || job.status === "error") {
      setStatus(printStatus, job.error || "Print failed.", "error");
      printBtn.disabled = false;
      return;
    }

    jobStatusEl.textContent = job.status;
    setStatus(printStatus, "Sent to printer. Watching progress...", "ok");
    cancelBtn.disabled = false;
    progressWrap.classList.remove("hidden");
    startPolling();
  } catch (err) {
    setStatus(printStatus, "Request failed: " + err.message, "error");
    printBtn.disabled = false;
  }
}

async function cancelPrint() {
  cancelBtn.disabled = true;
  try {
    await fetch("/api/printer/cancel", { method: "POST" });
    setStatus(printStatus, "Cancel requested.");
  } catch (err) {
    setStatus(printStatus, "Cancel failed: " + err.message, "error");
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/printer/status");
      if (!res.ok) return;
      const data = await res.json();
      const progress = data.progress || {};
      const pct = progress.completion || 0;
      progressFill.style.width = pct.toFixed(1) + "%";
      const state = (data.state || "").toLowerCase();
      progressLabel.textContent = `${data.state || "Unknown"} - ${pct.toFixed(1)}%`;

      if (state.includes("operational") || state.includes("finish") || state.includes("cancel")) {
        clearInterval(pollTimer);
        printBtn.disabled = false;
        cancelBtn.disabled = true;
      }
    } catch (_) {
      /* keep polling silently */
    }
  }, 4000);
}

async function refreshJobList() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();
  jobListEl.innerHTML = "";
  for (const job of jobs) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = job.prompt.length > 60 ? job.prompt.slice(0, 60) + "..." : job.prompt;
    const status = document.createElement("span");
    status.textContent = job.status;
    li.append(label, status);
    li.addEventListener("click", () => selectJob(job.id));
    jobListEl.appendChild(li);
  }
}

async function selectJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}`);
  const job = await res.json();
  currentJobId = job.id;
  jobIdEl.textContent = job.id;
  jobStatusEl.textContent = job.status;
  codeBlock.textContent = job.code || "";
  promptEl.value = job.prompt;
  if (job.has_stl) {
    loadSTL(`/api/jobs/${job.id}/stl?t=${Date.now()}`);
    printBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generate);
printBtn.addEventListener("click", print);
cancelBtn.addEventListener("click", cancelPrint);

refreshJobList();
