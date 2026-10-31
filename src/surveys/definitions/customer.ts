import { UserRole } from '../../types/index.js';
import { l, type SurveyDefinition } from './types.js';
import { easeScale, other, PROBLEM_DETAILS_HELP, TOP_THREE_HELP, yesNo } from './shared.js';

/**
 * IPILE Customer Testing & Validation Form (Survery.md).
 * Hausa, Yoruba and Igbo are drafts pending native-speaker review.
 */
export const customerSurvey: SurveyDefinition = {
  id: 'customer-v1',
  role: UserRole.CUSTOMER,
  title: l(
    'Customer testing & validation',
    'Gwaji da tabbatarwa na abokin ciniki',
    'Ìdánwò àti ìfọwọ́sí oníbàárà',
    'Nnwale na nkwado onye na-azụ ahịa',
  ),
  intro: l(
    'Please explore the IPILE website and answer honestly based on your experience. Your feedback will help us build a platform that makes buying fabrics and clothes easier, safer, and more reliable.',
    'Da fatan za ku bincika shafin IPILE kuma ku amsa da gaskiya bisa ga abin da kuka gani. Ra’ayinku zai taimaka mana gina dandali da zai sa siyan yadudduka da tufafi ya fi sauƙi, aminci, da dogaro.',
    'Ẹ jọ̀wọ́ ẹ ṣàwárí ojú-òpó IPILE kí ẹ sì dáhùn ní òtítọ́ gẹ́gẹ́ bí ìrírí yín. Èsì yín yóò ràn wá lọ́wọ́ láti kọ́ pẹpẹ tí yóò mú kí rírà aṣọ àti ẹ̀wù rọrùn, láìléwu, àti ṣeé gbẹ́kẹ̀lé.',
    'Biko nyochaa weebụsaịtị IPILE ma zaa n’eziokwu dabere na ahụmịhe gị. Nzaghachi gị ga-enyere anyị aka iwulite ikpo okwu na-eme ka ịzụ akwa na uwe dị mfe, dị nchebe, ma bụrụ nke a pụrụ ịtụkwasị obi.',
  ),
  questions: [
    {
      id: 'navigation',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to navigate the IPILE website and find what you were looking for?',
        'Yaya sauƙin yawo a shafin IPILE da samun abin da kuke nema ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti rìn kiri ojú-òpó IPILE kí ẹ sì rí ohun tí ẹ ń wá?',
        'Olee otú o si dị mfe ịgagharị na weebụsaịtị IPILE ma chọta ihe ị na-achọ?',
      ),
      options: easeScale({
        id: 'could_not_find',
        label: l(
          'I could not find what I wanted',
          'Ban sami abin da nake so ba',
          'Mi ò rí ohun tí mo fẹ́',
          'Achọtaghị m ihe m chọrọ',
        ),
      }),
    },
    {
      id: 'usage',
      kind: 'single',
      required: true,
      prompt: l(
        'What would you most likely use IPILE for?',
        'Me za ku fi IPILE yi mafi yawanci?',
        'Kí ni ẹ ṣeé ṣe jù lọ láti lo IPILE fún?',
        'Gịnị ka ị ga-eji IPILE mee karịa?',
      ),
      options: [
        { id: 'ready_made', label: l('Buying ready-made clothes', 'Siyan tufafin da aka riga aka ɗinka', 'Rírà ẹ̀wù tí a ti rán tán', 'Ịzụ uwe emeelarị') },
        { id: 'find_tailor', label: l('Finding a tailor for custom-made clothes', 'Nemo tela don ɗinka tufafi na musamman', 'Wíwá aránṣọ fún ẹ̀wù àdáni', 'Ịchọta onye na-akwa akwa maka uwe a kwara n’ọtụ') },
        { id: 'fabrics', label: l('Buying fabrics', 'Siyan yadudduka', 'Rírà aṣọ', 'Ịzụ akwa') },
        { id: 'inspiration', label: l('Finding inspiration for clothing designs', 'Nemo wahayi don zanen tufafi', 'Wíwá ìmísí fún àwòrán ẹ̀wù', 'Ịchọta mkpali maka ụdị uwe') },
        { id: 'multiple', label: l('More than one of the above', 'Fiye da ɗaya daga cikin waɗannan', 'Ju ẹyọ kan lọ nínú àwọn tó wà lókè', 'Ihe karịrị otu n’ime ndị a dị n’elu') },
      ],
    },
    {
      id: 'discovery',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to discover and compare fabrics or tailors on the platform?',
        'Yaya sauƙin ganowa da kwatanta yadudduka ko teloli a dandalin ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti ṣàwárí àti fi aṣọ tàbí aránṣọ wé ara wọn lórí pẹpẹ náà?',
        'Olee otú o si dị mfe ịchọpụta na ịtụnyere akwa ma ọ bụ ndị na-akwa akwa n’ikpo okwu ahụ?',
      ),
      options: easeScale({
        id: 'could_not_complete',
        label: l('I could not complete this task', 'Ban iya kammala wannan aikin ba', 'Mi ò lè parí iṣẹ́ yìí', 'Enweghị m ike imecha ọrụ a'),
      }),
    },
    {
      id: 'trust_info',
      kind: 'multi',
      required: true,
      prompt: l(
        'What information do you need before trusting a tailor or fabric seller enough to buy from them?',
        'Wane bayani kuke buƙata kafin ku amince da tela ko mai sayar da yadi har ku saya daga gare su?',
        'Ìsọfúnni wo ni ẹ nílò kí ẹ tó gbẹ́kẹ̀lé aránṣọ tàbí olùtajà aṣọ tó láti rà lọ́wọ́ wọn?',
        'Kedu ozi ị chọrọ tupu ị tụkwasị onye na-akwa akwa ma ọ bụ onye na-ere akwa obi ịzụ ihe n’aka ha?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'media', label: l('Real pictures and videos of their work or products', 'Hotuna da bidiyo na gaske na aikinsu ko kayansu', 'Àwòrán àti fídíò gidi ti iṣẹ́ tàbí ọjà wọn', 'Ezi foto na vidiyo nke ọrụ ma ọ bụ ngwaahịa ha') },
        { id: 'reviews', label: l('Customer reviews and ratings', 'Sharhi da ƙimar abokan ciniki', 'Àgbéyẹ̀wò àti ìdíwọ̀n oníbàárà', 'Nyocha na ọkwa ndị ahịa') },
        { id: 'pricing', label: l('Prices and product details', 'Farashi da bayanan kaya', 'Iye owó àti àlàyé ọjà', 'Ọnụahịa na nkọwa ngwaahịa') },
        { id: 'profile', label: l('Seller or tailor profile and experience', 'Bayanan mai sayarwa ko tela da gogewarsu', 'Àlàyé àti ìrírí olùtajà tàbí aránṣọ', 'Profaịlụ na ahụmịhe onye na-ere ma ọ bụ onye na-akwa akwa') },
        { id: 'verified', label: l('Verified identity or business details', 'Tabbatattun bayanan shaida ko kasuwanci', 'Ìdánimọ̀ tàbí àlàyé iṣòwò tí a ti fìdí rẹ̀ múlẹ̀', 'Njirimara ma ọ bụ nkọwa azụmahịa a kwadoro') },
        other(),
      ],
    },
    {
      id: 'custom_order_flow',
      kind: 'single',
      required: true,
      // Only for people who said they would use IPILE to find a tailor.
      showIf: { question: 'usage', anyOf: ['find_tailor', 'multiple'] },
      prompt: l(
        'If you wanted custom-made clothes, could you easily understand how to select a tailor, provide your measurements, and submit your order?',
        'Idan kuna son tufafin da aka ɗinka na musamman, shin kun iya fahimtar yadda za ku zaɓi tela, ku ba da ma’aunanku, kuma ku aika odarku cikin sauƙi?',
        'Bí ẹ bá fẹ́ ẹ̀wù àdáni, ṣé ẹ lè yára lóye bí ẹ ṣe lè yan aránṣọ, fi ìwọ̀n ara yín sílẹ̀, kí ẹ sì fi àṣẹ yín ránṣẹ́?',
        'Ọ bụrụ na ịchọrọ uwe a kwara n’ọtụ, ị ghọtara n’ụzọ dị mfe otú esi ahọrọ onye na-akwa akwa, nye nha gị, ma zipu ọda gị?',
      ),
      options: [
        { id: 'yes', label: l('Yes, completely', 'E, gaba ɗaya', 'Bẹ́ẹ̀ ni, pátápátá', 'Ee, kpamkpam') },
        { id: 'partially', label: l('Partially', 'Wani ɓangare', 'Díẹ̀díẹ̀', 'Ụfọdụ') },
        { id: 'no', label: l('No', "A'a", 'Rárá', 'Mba') },
        { id: 'not_found', label: l('I did not find this feature', 'Ban sami wannan fasalin ba', 'Mi ò rí ẹ̀yà yìí', 'Achọtaghị m akụkụ a') },
        { id: 'not_tested', label: l('I did not test this feature', 'Ban gwada wannan fasalin ba', 'Mi ò dán ẹ̀yà yìí wò', 'Anwaleghị m akụkụ a') },
      ],
    },
    {
      id: 'hesitations',
      kind: 'multi',
      required: true,
      prompt: l(
        'What would make you hesitate to buy fabrics or clothes through IPILE?',
        'Me zai sa ku yi jinkirin siyan yadudduka ko tufafi ta IPILE?',
        'Kí ni yóò mú kí ẹ ṣiyèméjì láti ra aṣọ tàbí ẹ̀wù nípasẹ̀ IPILE?',
        'Gịnị ga-eme ka ị la azụ ịzụ akwa ma ọ bụ uwe site na IPILE?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'scam', label: l('Fear of being scammed', 'Tsoron a yi muku zamba', 'Ìbẹ̀rù pé wọ́n lè lù mí ní jìbìtì', 'Egwu ka a ghara iduhie m') },
        { id: 'quality', label: l('Poor product or tailoring quality', 'Rashin ingancin kaya ko ɗinki', 'Ọjà tàbí ìránṣọ tí kò dára', 'Ngwaahịa ma ọ bụ ịkwa akwa na-adịghị mma') },
        { id: 'measurements', label: l('Incorrect measurements or fabric descriptions', 'Kuskuren ma’auni ko bayanin yadi', 'Ìwọ̀n tàbí àpèjúwe aṣọ tí kò tọ̀nà', 'Nha ma ọ bụ nkọwa akwa na-ezighị ezi') },
        { id: 'delivery', label: l('Delivery delays', 'Jinkirin isarwa', 'Ìdádúró ìfijíṣẹ́', 'Igbu oge nnyefe') },
        { id: 'pricing', label: l('Unclear pricing or additional charges', 'Farashi mara bayyana ko ƙarin caji', 'Iye owó tí kò ṣe kedere tàbí owó àfikún', 'Ọnụahịa na-edoghị anya ma ọ bụ ụgwọ ndị ọzọ') },
        { id: 'payment', label: l('Payment or refund concerns', 'Damuwa game da biya ko mayar da kuɗi', 'Àníyàn nípa ìsanwó tàbí dídá owó padà', 'Nchegbu gbasara ịkwụ ụgwọ ma ọ bụ nkwụghachi') },
        { id: 'nothing', exclusive: true, label: l('Nothing in particular', 'Babu wani abu na musamman', 'Kò sí ohun kan pàtó', 'Ọ dịghị ihe pụrụ iche') },
        other(),
      ],
    },
    {
      id: 'escrow_comfort',
      kind: 'single',
      required: true,
      prompt: l(
        'How comfortable would you feel paying through IPILE if your payment were held until you received your order and confirmed it?',
        'Yaya za ku ji game da biya ta IPILE idan aka riƙe kuɗinku har sai kun karɓi odarku kuma kun tabbatar?',
        'Báwo ni ọkàn yín yóò ṣe balẹ̀ tó láti sanwó nípasẹ̀ IPILE bí wọ́n bá di owó yín mú títí ẹ ó fi gba àṣẹ yín tí ẹ sì fìdí rẹ̀ múlẹ̀?',
        'Olee otú obi ga-eru gị ala ịkwụ ụgwọ site na IPILE ma ọ bụrụ na a ga-ejide ego gị ruo mgbe ị natara ọda gị ma kwado ya?',
      ),
      options: [
        { id: 'very', label: l('Very comfortable', 'Hankali kwance sosai', 'Ọkàn mi balẹ̀ gan-an', 'Obi dị m jụụ nke ukwuu') },
        { id: 'somewhat', label: l('Somewhat comfortable', 'Hankali kwance kaɗan', 'Ọkàn mi balẹ̀ díẹ̀', 'Obi dị m jụụ ntakịrị') },
        { id: 'unsure', label: l('Unsure', 'Ban tabbata ba', 'Mi ò dá mi lójú', 'Ejighị m n’aka') },
        { id: 'uncomfortable', label: l('Uncomfortable', 'Hankali bai kwanta ba', 'Ọkàn mi kò balẹ̀', 'Obi adịghị m jụụ') },
        { id: 'prefer_other', label: l('I would prefer another payment method', 'Zan fi son wata hanyar biya', 'Mo fẹ́ ọ̀nà ìsanwó mìíràn', 'Ọ ga-amasị m ụzọ ịkwụ ụgwọ ọzọ') },
      ],
    },
    {
      id: 'ordering_clarity',
      kind: 'single',
      required: true,
      prompt: l(
        'How clear were the ordering, payment, and delivery steps?',
        'Yaya matakan oda, biya, da isarwa suka bayyana?',
        'Báwo ni àwọn ìgbésẹ̀ àṣẹ, ìsanwó, àti ìfijíṣẹ́ ṣe ṣe kedere tó?',
        'Olee otú usoro ịtụ ọda, ịkwụ ụgwọ, na nnyefe si doo anya?',
      ),
      options: [
        { id: 'very_clear', label: l('Very clear', 'A bayyane sosai', 'Ó ṣe kedere gan-an', 'O doro anya nke ukwuu') },
        { id: 'mostly_clear', label: l('Mostly clear', 'A bayyane galibi', 'Ó ṣe kedere jù lọ', 'O doro anya n’ọtụtụ ebe') },
        { id: 'confusing_some', label: l('Confusing in some places', 'Mai rikitarwa a wasu wurare', 'Ó ń dàrú ní àwọn ibì kan', 'Ọ na-agbagwoju anya n’ebe ụfọdụ') },
        { id: 'very_confusing', label: l('Very confusing', 'Mai rikitarwa sosai', 'Ó dàrú gan-an', 'Ọ na-agbagwoju anya nke ukwuu') },
        { id: 'could_not_order', label: l('I could not complete an order', 'Ban iya kammala oda ba', 'Mi ò lè parí àṣẹ kan', 'Enweghị m ike imecha ọda') },
      ],
    },
    {
      id: 'had_problem',
      kind: 'single',
      required: true,
      prompt: l(
        'Did you encounter any problem while testing the website?',
        'Shin kun fuskanci wata matsala yayin gwada shafin?',
        'Ṣé ẹ bá ìṣòro kankan pàdé nígbà tí ẹ ń dán ojú-òpó náà wò?',
        'Ị zutere nsogbu ọ bụla mgbe ị na-anwale weebụsaịtị ahụ?',
      ),
      options: yesNo(),
    },
    {
      id: 'problem_details',
      kind: 'text',
      required: true,
      showIf: { question: 'had_problem', anyOf: ['yes'] },
      prompt: l(
        'Please describe the problem.',
        'Da fatan za ku bayyana matsalar.',
        'Ẹ jọ̀wọ́ ẹ ṣàpèjúwe ìṣòro náà.',
        'Biko kọwaa nsogbu ahụ.',
      ),
      help: PROBLEM_DETAILS_HELP,
    },
    {
      id: 'improvements',
      kind: 'list',
      items: 3,
      required: true,
      prompt: l(
        'What are the three most important improvements IPILE should make before launch?',
        'Waɗanne ingantawa uku ne mafi muhimmanci da IPILE ya kamata ya yi kafin ƙaddamarwa?',
        'Kí ni àwọn àtúnṣe mẹ́ta tó ṣe pàtàkì jù lọ tí IPILE yẹ kí ó ṣe kí ó tó ṣí sílẹ̀?',
        'Kedu mmezi atọ kachasị mkpa IPILE kwesịrị ime tupu mmalite?',
      ),
      help: TOP_THREE_HELP,
    },
  ],
};
