import { UserRole } from '../../types/index.js';
import { l, type SurveyDefinition } from './types.js';
import { COULD_NOT_COMPLETE, easeScale, other, PROBLEM_DETAILS_HELP, TOP_THREE_HELP, yesNo } from './shared.js';

/**
 * IPILE Fabric Seller Testing & Validation Form (Survery.md).
 * Hausa, Yoruba and Igbo are drafts pending native-speaker review.
 */
export const merchantSurvey: SurveyDefinition = {
  id: 'merchant-v1',
  role: UserRole.MERCHANT,
  title: l(
    'Fabric seller testing & validation',
    'Gwaji da tabbatarwa na mai sayar da yadi',
    'Ìdánwò àti ìfọwọ́sí olùtajà aṣọ',
    'Nnwale na nkwado onye na-ere akwa',
  ),
  intro: l(
    'Please test IPILE as a fabric seller. Your responses will help us improve how you showcase products, reach customers, process orders, and receive payments.',
    'Da fatan za ku gwada IPILE a matsayin mai sayar da yadi. Amsoshinku za su taimaka mana inganta yadda kuke nuna kaya, isa ga abokan ciniki, sarrafa oda, da karɓar kuɗi.',
    'Ẹ jọ̀wọ́ ẹ dán IPILE wò gẹ́gẹ́ bí olùtajà aṣọ. Ìdáhùn yín yóò ràn wá lọ́wọ́ láti mú bí ẹ ṣe ń ṣàfihàn ọjà, dé ọ̀dọ̀ oníbàárà, ṣètò àṣẹ, àti gba owó sunwọ̀n sí i.',
    'Biko nwalee IPILE dị ka onye na-ere akwa. Azịza gị ga-enyere anyị aka imeziwanye otú ị si egosi ngwaahịa, iru ndị ahịa, ịhazi ọda, na ịnata ụgwọ.',
  ),
  questions: [
    {
      id: 'profile_setup',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to create or access your seller profile and understand how to use it?',
        'Yaya sauƙin ƙirƙira ko shiga bayanan mai sayarwa naku da fahimtar yadda ake amfani da shi ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti ṣẹ̀dá tàbí wọlé sí àlàyé olùtajà yín kí ẹ sì lóye bí a ṣe ń lò ó?',
        'Olee otú o si dị mfe ịmepụta ma ọ bụ ịbanye na profaịlụ onye na-ere gị ma ghọta otú esi eji ya?',
      ),
      options: easeScale(COULD_NOT_COMPLETE),
    },
    {
      id: 'upload_media',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to upload and display real pictures or videos of your fabrics?',
        'Yaya sauƙin loda da nuna hotuna ko bidiyo na gaske na yaduddukanku ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti gbé àwòrán tàbí fídíò gidi ti aṣọ yín sókè kí ẹ sì ṣàfihàn wọn?',
        'Olee otú o si dị mfe ibulite na igosi ezi foto ma ọ bụ vidiyo nke akwa gị?',
      ),
      options: easeScale({
        id: 'could_not_upload',
        label: l('I could not upload my products', 'Ban iya loda kayana ba', 'Mi ò lè gbé ọjà mi sókè', 'Enweghị m ike ibulite ngwaahịa m'),
      }),
    },
    {
      id: 'listing_info',
      kind: 'multi',
      required: true,
      prompt: l(
        'What information do you need to display for each fabric to help customers make purchasing decisions?',
        'Wane bayani kuke buƙatar nunawa ga kowane yadi don taimaka wa abokan ciniki yanke shawarar saye?',
        'Ìsọfúnni wo ni ẹ nílò láti ṣàfihàn fún aṣọ kọ̀ọ̀kan láti ran oníbàárà lọ́wọ́ láti pinnu ohun tí wọn yóò rà?',
        'Kedu ozi ị chọrọ igosi maka akwa ọ bụla iji nyere ndị ahịa aka ikpebi ihe ha ga-azụ?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'material', label: l('Fabric type and material', 'Nau’in yadi da kayan da aka yi shi', 'Irú aṣọ àti ohun èlò rẹ̀', 'Ụdị akwa na ihe e ji mee ya') },
        { id: 'unit_price', label: l('Price per yard or other unit', 'Farashi a kowane yadi ko wani ma’auni', 'Iye owó fún yádì kan tàbí ìwọ̀n mìíràn', 'Ọnụahịa kwa yaadị ma ọ bụ nha ọzọ') },
        { id: 'colours', label: l('Available colours and patterns', 'Launuka da zane-zanen da ake da su', 'Àwọ̀ àti àpẹẹrẹ tó wà', 'Agba na ụkpụrụ dị') },
        { id: 'stock', label: l('Available quantity or stock', 'Yawan da ake da shi', 'Iye tó wà ní ìpamọ́', 'Ọnụọgụ dị n’ụlọ ahịa') },
        { id: 'specs', label: l('Fabric dimensions and specifications', 'Girman yadi da bayanai', 'Ìwọ̀n àti àlàyé pàtó aṣọ', 'Nha na nkọwa akwa') },
        { id: 'media', label: l('Real pictures and videos', 'Hotuna da bidiyo na gaske', 'Àwòrán àti fídíò gidi', 'Ezi foto na vidiyo') },
        { id: 'delivery', label: l('Delivery options', 'Zaɓuɓɓukan isarwa', 'Àwọn ọ̀nà ìfijíṣẹ́', 'Nhọrọ nnyefe') },
        other(),
      ],
    },
    {
      id: 'manage_listings',
      kind: 'single',
      required: true,
      prompt: l(
        'Could you easily find how to add, edit, or manage your fabric listings?',
        'Shin kun iya samun yadda ake ƙara, gyara, ko sarrafa jerin yaduddukanku cikin sauƙi?',
        'Ṣé ẹ lè yára rí bí a ṣe ń fi kún, ṣàtúnṣe, tàbí ṣàkóso àtòjọ aṣọ yín?',
        'Ị chọtara n’ụzọ dị mfe otú esi agbakwunye, dezie, ma ọ bụ jikwaa ndepụta akwa gị?',
      ),
      options: [
        { id: 'all_easy', label: l('Yes, all of these were easy', 'E, duk waɗannan sun kasance masu sauƙi', 'Bẹ́ẹ̀ ni, gbogbo wọn rọrùn', 'Ee, ha niile dị mfe') },
        { id: 'some_difficult', label: l('Some were easy, others were difficult', 'Wasu sun yi sauƙi, wasu sun yi wahala', 'Àwọn kan rọrùn, àwọn mìíràn nira', 'Ụfọdụ dị mfe, ndị ọzọ siri ike') },
        { id: 'confusing', label: l('No, the process was confusing', "A'a, aikin ya kasance mai rikitarwa", 'Rárá, ìgbésẹ̀ náà dàrú', 'Mba, usoro ahụ na-agbagwoju anya') },
        { id: 'not_found', label: l('I could not find these features', 'Ban iya samun waɗannan fasalolin ba', 'Mi ò rí àwọn ẹ̀yà wọ̀nyí', 'Achọtaghị m akụkụ ndị a') },
      ],
    },
    {
      id: 'discovery_confidence',
      kind: 'single',
      required: true,
      prompt: l(
        'After viewing the live feed, how confident are you that customers can discover your fabrics and find the products they want?',
        'Bayan kallon jerin kai tsaye, yaya kuke da tabbacin abokan ciniki za su iya gano yaduddukanku da samun kayan da suke so?',
        'Lẹ́yìn wíwo àtòjọ tó ń lọ lọ́wọ́, báwo ni ó ṣe dá yín lójú tó pé oníbàárà lè ṣàwárí aṣọ yín kí wọ́n sì rí ọjà tí wọ́n fẹ́?',
        'Mgbe ị lechara ndepụta dị ndụ, olee otú o si doo gị anya na ndị ahịa nwere ike ịchọpụta akwa gị ma chọta ngwaahịa ha chọrọ?',
      ),
      options: [
        { id: 'very', label: l('Very confident', 'Da tabbaci sosai', 'Ó dá mi lójú gan-an', 'O doro m anya nke ukwuu') },
        { id: 'somewhat', label: l('Somewhat confident', 'Da tabbaci kaɗan', 'Ó dá mi lójú díẹ̀', 'O doro m anya ntakịrị') },
        { id: 'not', label: l('Not confident', 'Ba da tabbaci ba', 'Kò dá mi lójú', 'O doghị m anya') },
        { id: 'could_not_tell', label: l('I could not determine this during testing', 'Ban iya tantance wannan ba yayin gwaji', 'Mi ò lè mọ̀ èyí nígbà ìdánwò', 'Enweghị m ike ịmata nke a n’oge nnwale') },
      ],
    },
    {
      id: 'discovery_improvements',
      kind: 'text',
      required: false,
      showIf: { question: 'discovery_confidence', noneOf: ['very'] },
      prompt: l(
        'What would improve product discovery?',
        'Me zai inganta gano kaya?',
        'Kí ni yóò mú kí ṣíṣàwárí ọjà sunwọ̀n sí i?',
        'Gịnị ga-eme ka ịchọpụta ngwaahịa ka mma?',
      ),
    },
    {
      id: 'fulfilment_issues',
      kind: 'multi',
      required: true,
      prompt: l(
        'What would make it difficult for you to fulfil an order received through IPILE?',
        'Me zai sa ya yi muku wahala ku cika odar da aka karɓa ta IPILE?',
        'Kí ni yóò mú kí ó nira fún yín láti mú àṣẹ tí ẹ gbà nípasẹ̀ IPILE ṣẹ?',
        'Gịnị ga-eme ka o sie gị ike imezu ọda e nwetara site na IPILE?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'unclear_details', label: l('Unclear order details', 'Bayanan oda marasa bayyana', 'Àlàyé àṣẹ tí kò ṣe kedere', 'Nkọwa ọda na-edoghị anya') },
        { id: 'stock', label: l('Difficulty confirming available stock', 'Wahalar tabbatar da kayan da ake da su', 'Ìṣòro ní fífìdí ọjà tó wà múlẹ̀', 'Ihe isi ike ịkwado ngwaahịa dị') },
        { id: 'packaging', label: l('Packaging or delivery arrangements', 'Shirye-shiryen kunshi ko isarwa', 'Ètò ìdìpọ̀ tàbí ìfijíṣẹ́', 'Nhazi nkwakọ ngwaahịa ma ọ bụ nnyefe') },
        { id: 'delivery_cost', label: l('Delivery costs', 'Kuɗin isarwa', 'Owó ìfijíṣẹ́', 'Ọnụ nnyefe') },
        { id: 'cancellations', label: l('Customer cancellations', 'Soke oda daga abokan ciniki', 'Ìfagilé láti ọ̀dọ̀ oníbàárà', 'Ndị ahịa na-akagbu ọda') },
        { id: 'payment_delays', label: l('Payment delays', 'Jinkirin biya', 'Ìdádúró ìsanwó', 'Igbu oge ịkwụ ụgwọ') },
        { id: 'communication', label: l('Difficulty communicating with customers', 'Wahalar sadarwa da abokan ciniki', 'Ìṣòro ní bíbá oníbàárà sọ̀rọ̀', 'Ihe isi ike ịkparịta ụka na ndị ahịa') },
        other(),
      ],
    },
    {
      id: 'escrow_comfort',
      kind: 'single',
      required: true,
      prompt: l(
        "How comfortable are you with IPILE holding a customer's payment until the customer receives and confirms delivery of the fabric?",
        'Yaya hankalinku yake game da IPILE ya riƙe kuɗin abokin ciniki har sai abokin cinikin ya karɓi yadin kuma ya tabbatar da isarwa?',
        'Báwo ni ọkàn yín ṣe balẹ̀ tó pẹ̀lú bí IPILE ṣe ń di owó oníbàárà mú títí oníbàárà yóò fi gba aṣọ náà tí yóò sì fìdí ìfijíṣẹ́ múlẹ̀?',
        'Olee otú obi si eru gị ala na IPILE na-ejide ụgwọ onye ahịa ruo mgbe onye ahịa natara akwa ahụ ma kwado nnyefe?',
      ),
      options: [
        { id: 'very', label: l('Very comfortable', 'Hankali kwance sosai', 'Ọkàn mi balẹ̀ gan-an', 'Obi dị m jụụ nke ukwuu') },
        { id: 'somewhat', label: l('Somewhat comfortable', 'Hankali kwance kaɗan', 'Ọkàn mi balẹ̀ díẹ̀', 'Obi dị m jụụ ntakịrị') },
        { id: 'unsure', label: l('Unsure', 'Ban tabbata ba', 'Mi ò dá mi lójú', 'Ejighị m n’aka') },
        { id: 'uncomfortable', label: l('Uncomfortable', 'Hankali bai kwanta ba', 'Ọkàn mi kò balẹ̀', 'Obi adịghị m jụụ') },
      ],
    },
    {
      id: 'escrow_conditions',
      kind: 'text',
      required: false,
      showIf: { question: 'escrow_comfort', noneOf: ['very'] },
      prompt: l(
        'What conditions would make this process fair to you?',
        'Waɗanne sharuɗɗa ne za su sa wannan tsarin ya zama adalci a gare ku?',
        'Àwọn àdéhùn wo ni yóò mú kí ìgbésẹ̀ yìí jẹ́ òdodo fún yín?',
        'Kedu ọnọdụ ga-eme ka usoro a dị gị mma?',
      ),
    },
    {
      id: 'dispute_concerns',
      kind: 'text',
      required: true,
      prompt: l(
        'What concerns would you have about refunds, returns, damaged fabrics, delivery disputes, or customers who do not confirm receipt?',
        'Waɗanne damuwa za ku iya samu game da mayar da kuɗi, dawo da kaya, lalacewar yadi, rikicin isarwa, ko abokan cinikin da ba sa tabbatar da karɓa?',
        'Àníyàn wo ni ẹ lè ní nípa dídá owó padà, dídá ọjà padà, aṣọ tó bàjẹ́, aáwọ̀ ìfijíṣẹ́, tàbí oníbàárà tí kò fìdí ìgbàwọlé múlẹ̀?',
        'Kedu nchegbu ị ga-enwe gbasara nkwụghachi ego, ịlaghachi ngwaahịa, akwa mebiri emebi, esemokwu nnyefe, ma ọ bụ ndị ahịa na-adịghị akwado na ha natara?',
      ),
    },
    {
      id: 'had_problem',
      kind: 'single',
      required: true,
      prompt: l(
        'Did you experience any technical problems or difficulties while creating listings, managing products, or testing the website?',
        'Shin kun fuskanci wata matsalar fasaha ko wahala yayin ƙirƙirar jeri, sarrafa kaya, ko gwada shafin?',
        'Ṣé ẹ ní ìṣòro ìmọ̀-ẹ̀rọ tàbí ìnira kankan nígbà tí ẹ ń ṣẹ̀dá àtòjọ, ṣàkóso ọjà, tàbí dán ojú-òpó wò?',
        'Ị nwere nsogbu teknụzụ ma ọ bụ ihe isi ike mgbe ị na-emepụta ndepụta, na-ajikwa ngwaahịa, ma ọ bụ na-anwale weebụsaịtị?',
      ),
      options: yesNo(),
    },
    {
      id: 'problem_details',
      kind: 'text',
      required: true,
      showIf: { question: 'had_problem', anyOf: ['yes'] },
      prompt: l(
        'Describe the steps you took and what went wrong.',
        'Bayyana matakan da kuka ɗauka da abin da ya faru ba daidai ba.',
        'Ẹ ṣàpèjúwe àwọn ìgbésẹ̀ tí ẹ gbé àti ohun tí kò lọ dáadáa.',
        'Kọwaa usoro ị mere na ihe na-agaghị nke ọma.',
      ),
      help: PROBLEM_DETAILS_HELP,
    },
    {
      id: 'improvements',
      kind: 'list',
      items: 3,
      required: true,
      prompt: l(
        'What three changes would make IPILE more useful for your fabric business and encourage you to sell through the platform regularly?',
        'Waɗanne canje-canje uku ne za su sa IPILE ya fi amfani ga kasuwancin yadinku kuma su ƙarfafa ku ku riƙa sayarwa ta dandalin?',
        'Àwọn àyípadà mẹ́ta wo ni yóò mú kí IPILE wúlò sí i fún iṣòwò aṣọ yín kí ó sì gbà yín níyànjú láti máa tà nípasẹ̀ pẹpẹ náà déédéé?',
        'Kedu mgbanwe atọ ga-eme ka IPILE baa uru karịa maka azụmahịa akwa gị ma gbaa gị ume ire ahịa site na ikpo okwu a mgbe niile?',
      ),
      help: TOP_THREE_HELP,
    },
  ],
};
