// FRC Inserter settings. After editing, click the reload button on the
// extension at chrome://extensions and refresh your Onshape tab.
globalThis.FRCI = globalThis.FRCI || {};

FRCI.config = {
  // Where docs/ is hosted. Must match the start of the Action URL registered
  // for the right-panel extension in the Onshape Developer Portal.
  panelUrl: 'https://YOUR-GITHUB-USERNAME.github.io/Onshape-Inserter/',

  // The extension's name in the Developer Portal. Used to find its button on
  // the right side of the assembly so the panel can be opened for you.
  panelName: 'FRC Inserter',
  // Set this to a CSS selector for that button if it can't be found by name.
  panelButtonSelector: '',

  // Physical key (KeyboardEvent.code) plus modifiers. Default: Alt+I (Option+I on a Mac).
  hotkey: { code: 'KeyI', alt: true, shift: false, ctrl: false, meta: false },

  // Open the panel automatically when you press the hotkey, and close it again
  // after inserting if it was opened for you.
  autoOpenPanel: true,
  closePanelAfterInsert: true,

  // How close to parallel the two selections must be, and how far apart two
  // hole centers can be sideways before they don't count as lined up.
  parallelToleranceDeg: 0.5,
  coaxialToleranceIn: 0.02,

  // Logs selections, API errors and mate checks to the Onshape tab's console.
  debug: false,

  // The library. Each part's Part Studio needs a length configuration input
  // (named by lengthParameter). Paste the Part Studio tab's URL from your
  // library document; the newest version of that document is used, unless
  // the URL is itself a version URL (/v/...), which pins that version.
  //
  //   key               Key that picks this part in the picker
  //   lengthParameter   Configuration input name (or ID) that sets the length
  //   otherConfiguration  Other inputs by name, e.g. { 'Hex size': '1/2 in' }
  //                       (list inputs take the option name as shown in Onshape)
  //   partName          Which part to insert if the Part Studio has several
  //   extraLength       Inches added to the gap. With a FASTENED or REVOLUTE
  //                     mate the part starts flush at the first hole and the
  //                     extra sticks out past the second; otherwise it's split
  //                     evenly between both ends.
  //   lengthStep        Round the length to this many inches (0 = exact)
  //   mate              FASTENED, REVOLUTE, CYLINDRICAL or NONE
  parts: [
    {
      key: '1',
      name: '#10 Spacer',
      partStudioUrl: '',
      lengthParameter: 'Length',
      otherConfiguration: {},
      extraLength: 0,
      lengthStep: 0,
      mate: 'FASTENED',
    },
    {
      key: '2',
      name: 'Hex Shaft',
      partStudioUrl: '',
      lengthParameter: 'Length',
      otherConfiguration: {},
      extraLength: 0,
      lengthStep: 0,
      mate: 'REVOLUTE',
    },
  ],
};
