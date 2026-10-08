/**
 * What a language model reads about each tool and its inputs. Kept apart
 * from the code so the words can be checked and changed in one place.
 *
 * The builder knows no game: these words speak only of characters,
 * choices, options, values, things, steps and levels. Every name a tool
 * returns comes from the package's texts, in the player's language.
 */

export const INTRO =
  "Tools for the player's characters in the character builder. A character is built by answering choices " +
  "(pick an option, give points to values, type a name). The builder checks every answer against the rules of " +
  "the package the character uses and says why if one does not fit. All names and explanations come from the " +
  "package, in the player's language; use them as they are and ask the player before deciding for them.";

export const TOOL_DESCRIPTIONS = {
  list_packages:
    "List the rule packages the builder has loaded, with id, name and a short description. " +
    "A new character is always built with one package (see start_character). A package may list " +
    "extensions: more options a character can use on top of it; notForSharing marks content the player " +
    "may not pass on.",
  list_characters:
    "List the player's own characters: id, name, level, whether finished or still open, and the one-line " +
    "summary. Use the id with the other tools.",
  get_character:
    "Read one character: its level, every value with its name and number, everything it has (with a short " +
    "explanation), the answers given so far, the choices still open, and the summary. Read this before " +
    "talking about a character.",
  explain_value:
    "Explain where one number of a character comes from: its parts (a starting number, an answer, a thing " +
    "the character has, other values) that add up to the total. Value ids are in get_character.",
  list_open_choices:
    "List the choices of a character that still need an answer, in the order the builder asks them, with " +
    "their question and how much is missing. Answer them with set_answer (or answer_pool for a step with a " +
    "shared list). Empty means the character can be finished.",
  list_options:
    "Show everything about one choice: the question, its options with name, short text, what it is, what " +
    "you do with it, who it suits, whether it is recommended and its badge; for a distribute choice the values, " +
    "methods and a recommended answer; and the exact shape the answer must have. Show the player the options " +
    "before answering.",
  set_answer:
    "Answer one choice of a character, or remove its answer with answer null. The shape follows the " +
    'choice\'s kind (see list_options): pickOne {"pick": "<option id>"}, pickMany {"picks": [...]}, ' +
    'distribute {"method": <index>, "assign": {"<value id>": <number>}}, number {"value": <number>}, ' +
    'text {"text": "..."}. If the rules refuse the answer, the result says why and nothing changes. ' +
    "An answer can change what is asked after it, never what comes before.",
  answer_pool:
    "Answer all choices of a step that share one list of options at once: give every pick of the step and " +
    "the builder spreads them over its choices. list_open_choices says which steps have a shared list.",
  start_character:
    "Start a new, empty character with a package (id from list_packages) at a level. Returns its id and " +
    "the first choices to answer.",
  set_level:
    "Change the level of a character that is not finished yet. Answers stay; choices of other levels come " +
    "or go. To raise a finished character use level_up instead.",
  level_up:
    "Raise a finished character to a higher level. Every answer stays. toAnswer in the result lists every " +
    "choice the higher level asks: new choices and choices that got more places (more picks or points). " +
    "Answer all of them (list_open_choices shows the same), then finish the character again.",
  finish_character:
    "Mark a character as finished once nothing is open. If something is still open, nothing changes and " +
    "the result lists the open choices.",
  get_sheet:
    "Get the finished character's sheet, in the player's language and units: as data (every section, row " +
    "and number of the printed sheet) or as the PDF file to print. Only for finished characters.",
} as const;

export type ToolName = keyof typeof TOOL_DESCRIPTIONS;

export const INPUT_DESCRIPTIONS = {
  characterId: "The character's id (from list_characters or start_character).",
  packageId: "The package id (from list_packages).",
  extensions:
    "Extension ids of the package to use (from list_packages); without them the character uses the package alone.",
  level: "The level, a whole number.",
  startLevel: "The level to build for, a whole number. Without it the package's usual start level.",
  raiseLevel: "The new level, higher than the current one.",
  value: "The value id (from get_character).",
  choice: "The choice id (from list_open_choices or get_character), copied exactly, also with an @ in it.",
  answer:
    "The answer in the shape of the choice's kind (see list_options), or null to remove the stored answer.",
  step: "The step id of a step with a shared list (from list_open_choices).",
  picks: "Every option id picked in this step, as one list.",
  sheetAs: 'What to return: "data" (default), the sheet as structured data; "pdf", the printable file.',
  parts: 'For the PDF: which parts, any of "sheet", "cards", "texts". Default: the sheet and the cards.',
  design: 'For the PDF: how the sheet looks, "verbose" (default) or "classic".',
} as const;
