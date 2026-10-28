export const BRAILLE_LANGUAGES = [
  "Albanian",
  "Basque (Spain)",
  "Belarusian",
  "Bulgarian",
  "Catalan (Spain)",
  "Croatian",
  "Czech",
  "Danish",
  "Dutch",
  "EBU",
  "English (UK)",
  "English",
  "Estonian",
  "Faroese (Denmark)",
  "Finnish",
  "French (Antoine)",
  "French (Traditional)",
  "Galician (Spain)",
  "German",
  "Greek",
  "Greenlandic",
  "Hungarian",
  "Icelandic",
  "Irish (Gaelic)",
  "Italian",
  "Kazakh",
  "Latvian",
  "Lithuanian",
  "Maltese",
  "Norwegian",
  "Polish",
  "Portuguese",
  "Romanian",
  "Russian",
  "Serbian",
  "Slovakian",
  "Slovene",
  "Spanish",
  "Swedish",
  "Turkish",
  "UEB",
  "Ukrainian",
  "Uzbek",
] as const;

export const BRAILLE_RESOLUTIONS = [
  "200 dpi",
  "300 dpi",
  "400 dpi",
  "600 dpi (small labels)",
] as const;

export type BrailleInspectionOptions = {
  language: (typeof BRAILLE_LANGUAGES)[number];
  resolution: (typeof BRAILLE_RESOLUTIONS)[number];
  enableOverprint: boolean;
};

export const DEFAULT_BRAILLE_INSPECTION_OPTIONS: BrailleInspectionOptions = {
  language: "English",
  resolution: "300 dpi",
  enableOverprint: true,
};
