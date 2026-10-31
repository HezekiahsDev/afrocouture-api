import { l, type Localized, type SurveyOption } from './types.js';

/** Very easy … Very difficult, then a form-specific "could not" option. */
export const easeScale = (last: SurveyOption): SurveyOption[] => [
  { id: 'very_easy', label: l('Very easy', 'Mai sauƙi sosai', 'Ó rọrùn gan-an', 'Ọ dị mfe nke ukwuu') },
  { id: 'easy', label: l('Easy', 'Mai sauƙi', 'Ó rọrùn', 'Ọ dị mfe') },
  { id: 'difficult', label: l('Difficult', 'Mai wahala', 'Ó nira', 'Ọ siri ike') },
  { id: 'very_difficult', label: l('Very difficult', 'Mai wahala sosai', 'Ó nira gan-an', 'Ọ siri ike nke ukwuu') },
  last,
];

export const other = (): SurveyOption => ({
  id: 'other',
  other: true,
  label: l('Other', 'Wani abu', 'Òmíràn', 'Ihe ọzọ'),
});

export const yesNo = (): SurveyOption[] => [
  { id: 'yes', label: l('Yes', 'E', 'Bẹ́ẹ̀ ni', 'Ee') },
  { id: 'no', label: l('No', "A'a", 'Rárá', 'Mba') },
];

export const COULD_NOT_COMPLETE: SurveyOption = {
  id: 'could_not_complete',
  label: l(
    'I could not complete the process',
    'Ban iya kammala aikin ba',
    'Mi ò lè parí ìgbésẹ̀ náà',
    'Enweghị m ike imecha usoro ahụ',
  ),
};

export const PROBLEM_DETAILS_HELP: Localized = l(
  'Describe what you were trying to do, what happened, and which page or feature caused the problem.',
  'Bayyana abin da kuke ƙoƙarin yi, abin da ya faru, da shafi ko fasalin da ya jawo matsalar.',
  'Ẹ ṣàlàyé ohun tí ẹ ń gbìyànjú láti ṣe, ohun tó ṣẹlẹ̀, àti ojú-ìwé tàbí ẹ̀yà tó fa ìṣòro náà.',
  'Kọwaa ihe ị na-achọ ime, ihe mere, na ibe ma ọ bụ akụkụ kpatara nsogbu ahụ.',
);

export const TOP_THREE_HELP: Localized = l(
  'List up to three, most important first.',
  'Rubuta har uku, mafi muhimmanci da farko.',
  'Ẹ kọ títí dé mẹ́ta, èyí tó ṣe pàtàkì jù lọ ní àkọ́kọ́.',
  'Depụta ruo atọ, nke kachasị mkpa na mbụ.',
);
