// Who made this.
//
// The name below was INFERRED, not given: the repository is psloper/psloper,
// the account email is psloper@gmail.com, and a project setting in this
// workspace refers to the owner as Paul. If any of it is wrong, this is the
// only place it needs changing: the report byline, the Word and Excel document
// properties, the page footer and the package manifest all read from here.

export const AUTHOR = {
  name: 'Paul Sloper',
  role: 'Developer',
  // Left empty deliberately. Add an organisation or a contact address here if
  // reports are going to circulate outside your own team.
  organisation: '',
  contact: '',
};

/** One line for a report byline or a document property. */
export function authorLine() {
  const bits = [AUTHOR.name];
  if (AUTHOR.organisation) bits.push(AUTHOR.organisation);
  return `${AUTHOR.role}: ${bits.join(', ')}`;
}
