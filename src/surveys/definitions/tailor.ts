import { UserRole } from '../../types/index.js';
import { l, type SurveyDefinition } from './types.js';
import { COULD_NOT_COMPLETE, easeScale, other, TOP_THREE_HELP } from './shared.js';

/**
 * IPILE Tailor Testing & Validation Form (Survery.md).
 * Hausa, Yoruba and Igbo are drafts pending native-speaker review.
 */
export const tailorSurvey: SurveyDefinition = {
  id: 'tailor-v1',
  role: UserRole.TAILOR,
  title: l(
    'Tailor testing & validation',
    'Gwaji da tabbatarwa na tela',
    'Ìdánwò àti ìfọwọ́sí aránṣọ',
    'Nnwale na nkwado onye na-akwa akwa',
  ),
  intro: l(
    'Please test IPILE from the perspective of a working tailor. We want to understand what helps you attract customers, manage orders, deliver quality clothing, and grow your business.',
    'Da fatan za ku gwada IPILE ta mahangar tela mai aiki. Muna son fahimtar abin da ke taimaka muku jawo abokan ciniki, sarrafa oda, isar da tufafi masu inganci, da bunƙasa kasuwancinku.',
    'Ẹ jọ̀wọ́ ẹ dán IPILE wò gẹ́gẹ́ bí aránṣọ tó ń ṣiṣẹ́. A fẹ́ lóye ohun tó ń ràn yín lọ́wọ́ láti fa oníbàárà mọ́ra, ṣàkóso àṣẹ, fi ẹ̀wù tó dára jíṣẹ́, kí iṣòwò yín sì gbèrú.',
    'Biko nwalee IPILE site n’anya onye na-akwa akwa na-arụ ọrụ. Anyị chọrọ ịghọta ihe na-enyere gị aka ịdọta ndị ahịa, jikwaa ọda, nyefee uwe dị mma, ma too azụmahịa gị.',
  ),
  questions: [
    {
      id: 'profile_setup',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to access your tailor profile and understand how to showcase your work?',
        'Yaya sauƙin shiga bayanan tela naku da fahimtar yadda za ku nuna aikinku ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti wọlé sí àlàyé aránṣọ yín kí ẹ sì lóye bí ẹ ṣe lè ṣàfihàn iṣẹ́ yín?',
        'Olee otú o si dị mfe ịbanye na profaịlụ onye na-akwa akwa gị ma ghọta otú esi egosi ọrụ gị?',
      ),
      options: easeScale(COULD_NOT_COMPLETE),
    },
    {
      id: 'upload_work',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to upload pictures and videos of clothes you have physically made?',
        'Yaya sauƙin loda hotuna da bidiyo na tufafin da kuka ɗinka da hannunku ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti gbé àwòrán àti fídíò ẹ̀wù tí ẹ ti rán ní tòótọ́ sókè?',
        'Olee otú o si dị mfe ibulite foto na vidiyo nke uwe ị kwara n’ezie?',
      ),
      options: easeScale({
        id: 'could_not_upload',
        label: l('I could not upload my work', 'Ban iya loda aikina ba', 'Mi ò lè gbé iṣẹ́ mi sókè', 'Enweghị m ike ibulite ọrụ m'),
      }),
    },
    {
      id: 'profile_info',
      kind: 'multi',
      required: true,
      prompt: l(
        'What information should customers see on your profile before choosing you?',
        'Wane bayani ya kamata abokan ciniki su gani a bayananku kafin su zaɓe ku?',
        'Ìsọfúnni wo ló yẹ kí oníbàárà rí lórí àlàyé yín kí wọ́n tó yàn yín?',
        'Kedu ozi ndị ahịa kwesịrị ịhụ na profaịlụ gị tupu ha ahọrọ gị?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'portfolio', label: l('Portfolio of completed work', 'Tarin ayyukan da aka kammala', 'Àkójọ iṣẹ́ tí a ti parí', 'Nchịkọta ọrụ emechara') },
        { id: 'reviews', label: l('Customer ratings and reviews', 'Ƙima da sharhin abokan ciniki', 'Ìdíwọ̀n àti àgbéyẹ̀wò oníbàárà', 'Ọkwa na nyocha ndị ahịa') },
        { id: 'specialisation', label: l('Specialisation and clothing styles', 'Ƙwarewa da salon tufafi', 'Àkànṣe iṣẹ́ àti àṣà ẹ̀wù', 'Ọkachamara na ụdị uwe') },
        { id: 'prices', label: l('Prices or estimated price ranges', 'Farashi ko kimanin farashi', 'Iye owó tàbí ìfojúdíwọ̀n iye owó', 'Ọnụahịa ma ọ bụ ọnụahịa a tụrụ atụ') },
        { id: 'location', label: l('Location and delivery options', 'Wuri da zaɓuɓɓukan isarwa', 'Ibùdó àti àwọn ọ̀nà ìfijíṣẹ́', 'Ebe obibi na nhọrọ nnyefe') },
        { id: 'capacity', label: l('Availability and production capacity', 'Samuwa da ƙarfin samarwa', 'Wíwà lárọ̀ọ́wọ́tó àti agbára iṣẹ́', 'Ịdị njikere na ike mmepụta') },
        { id: 'experience', label: l('Experience and business details', 'Gogewa da bayanan kasuwanci', 'Ìrírí àti àlàyé iṣòwò', 'Ahụmịhe na nkọwa azụmahịa') },
        other(),
      ],
    },
    {
      id: 'listing_orders',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to understand how to list ready-made clothes for sale and receive custom clothing orders?',
        'Yaya sauƙin fahimtar yadda ake jera tufafin da aka riga aka ɗinka don sayarwa da karɓar odar tufafi na musamman ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti lóye bí a ṣe ń ṣe àtòjọ ẹ̀wù tí a ti rán tán fún títà àti gbígba àṣẹ ẹ̀wù àdáni?',
        'Olee otú o si dị mfe ịghọta otú esi edepụta uwe emeelarị maka ire na ịnata ọda uwe a kwara n’ọtụ?',
      ),
      options: easeScale({
        id: 'not_found',
        label: l('I could not find these features', 'Ban iya samun waɗannan fasalolin ba', 'Mi ò rí àwọn ẹ̀yà wọ̀nyí', 'Achọtaghị m akụkụ ndị a'),
      }),
    },
    {
      id: 'order_requirements',
      kind: 'multi',
      required: true,
      prompt: l(
        'For custom orders, what information do you need from a customer before you can confidently begin production?',
        'Ga odar musamman, wane bayani kuke buƙata daga abokin ciniki kafin ku fara aiki da kwarin gwiwa?',
        'Fún àṣẹ àdáni, ìsọfúnni wo ni ẹ nílò láti ọ̀dọ̀ oníbàárà kí ẹ tó lè bẹ̀rẹ̀ iṣẹ́ pẹ̀lú ìgboyà?',
        'Maka ọda a kwara n’ọtụ, kedu ozi ị chọrọ n’aka onye ahịa tupu ị malite ọrụ n’obi ike?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'measurements', label: l('Accurate body measurements', 'Ingantattun ma’aunan jiki', 'Ìwọ̀n ara tó péye', 'Nha ahụ ziri ezi') },
        { id: 'references', label: l('Reference pictures or design specifications', 'Hotunan misali ko bayanan zane', 'Àwòrán àpẹẹrẹ tàbí àlàyé àwòṣe', 'Foto ntụnyere ma ọ bụ nkọwa ụdị') },
        { id: 'fabric', label: l('Fabric type and availability', 'Nau’in yadi da samuwarsa', 'Irú aṣọ àti wíwà rẹ̀', 'Ụdị akwa na ịdị ya') },
        { id: 'style', label: l('Clothing style and finishing details', 'Salon tufa da bayanan kammalawa', 'Àṣà ẹ̀wù àti àlàyé ìparí', 'Ụdị uwe na nkọwa mmecha') },
        { id: 'budget', label: l('Budget or agreed price', 'Kasafin kuɗi ko farashin da aka amince', 'Ìnáwó tàbí iye owó tí a fohùn ṣọ̀kan lé', 'Mmefu ego ma ọ bụ ọnụahịa e kwekọrịtara') },
        { id: 'location', label: l('Delivery location', 'Wurin isarwa', 'Ibi ìfijíṣẹ́', 'Ebe nnyefe') },
        { id: 'deadline', label: l('Required completion date', 'Ranar da ake buƙatar kammalawa', 'Ọjọ́ tí a fẹ́ kí ó parí', 'Ụbọchị a chọrọ ka emecha ya') },
        other(),
      ],
    },
    {
      id: 'fabric_handover',
      kind: 'single',
      required: true,
      prompt: l(
        'How easy was it to understand the process for receiving fabric from a customer and accessing their measurements and order details?',
        'Yaya sauƙin fahimtar tsarin karɓar yadi daga abokin ciniki da samun ma’aunansa da bayanan odarsa ya kasance?',
        'Báwo ni ó ṣe rọrùn tó láti lóye ìgbésẹ̀ gbígba aṣọ láti ọ̀dọ̀ oníbàárà àti rírí ìwọ̀n àti àlàyé àṣẹ wọn?',
        'Olee otú o si dị mfe ịghọta usoro ịnata akwa n’aka onye ahịa na ịhụ nha ya na nkọwa ọda ya?',
      ),
      options: easeScale({
        id: 'could_not_test',
        label: l('I could not find or test this process', 'Ban iya samu ko gwada wannan tsarin ba', 'Mi ò lè rí tàbí dán ìgbésẹ̀ yìí wò', 'Enweghị m ike ịchọta ma ọ bụ nwalee usoro a'),
      }),
    },
    {
      id: 'handover_improvements',
      kind: 'text',
      required: false,
      showIf: { question: 'fabric_handover', noneOf: ['very_easy', 'easy'] },
      prompt: l(
        'What would make this process easier?',
        'Me zai sa wannan tsarin ya fi sauƙi?',
        'Kí ni yóò mú kí ìgbésẹ̀ yìí rọrùn sí i?',
        'Gịnị ga-eme ka usoro a dị mfe karịa?',
      ),
    },
    {
      id: 'payment_split',
      kind: 'single',
      required: true,
      prompt: l(
        'IPILE proposes that 60% of the order payment becomes available to the tailor upfront, while 40% remains secured until the customer receives and confirms the completed clothes. How workable is this arrangement for your business?',
        'IPILE na shawarar cewa kashi 60% na kuɗin oda ya kasance ga tela tun farko, yayin da kashi 40% ya kasance a tsare har sai abokin ciniki ya karɓi tufafin da aka kammala kuma ya tabbatar. Yaya wannan tsari zai yi aiki ga kasuwancinku?',
        'IPILE dábàá pé ìdá 60% owó àṣẹ yóò wà fún aránṣọ ní ìbẹ̀rẹ̀, nígbà tí ìdá 40% yóò wà ní ìpamọ́ títí oníbàárà yóò fi gba ẹ̀wù tí a ti parí tí yóò sì fìdí rẹ̀ múlẹ̀. Báwo ni ètò yìí ṣe ṣeé ṣe tó fún iṣòwò yín?',
        'IPILE na-atụ aro ka pasent 60 nke ụgwọ ọda dịrị onye na-akwa akwa n’isi mbụ, ebe pasent 40 ga-anọ na nchekwa ruo mgbe onye ahịa natara uwe emechara ma kwado ya. Olee otú nhazi a si kwe omume maka azụmahịa gị?',
      ),
      options: [
        { id: 'very_workable', label: l('Very workable', 'Zai yi aiki sosai', 'Ó ṣeé ṣe gan-an', 'Ọ ga-arụ ọrụ nke ọma') },
        { id: 'needs_changes', label: l('Workable, but I need some changes', 'Zai yi aiki, amma ina buƙatar wasu canje-canje', 'Ó ṣeé ṣe, ṣùgbọ́n mo nílò àwọn àyípadà kan', 'Ọ ga-arụ ọrụ, mana achọrọ m mgbanwe ụfọdụ') },
        { id: 'not_workable', label: l('Not workable', 'Ba zai yi aiki ba', 'Kò ṣeé ṣe', 'Ọ gaghị arụ ọrụ') },
        { id: 'unsure', label: l('Unsure', 'Ban tabbata ba', 'Mi ò dá mi lójú', 'Ejighị m n’aka') },
      ],
    },
    {
      id: 'payment_alternative',
      kind: 'text',
      required: false,
      showIf: { question: 'payment_split', noneOf: ['very_workable'] },
      prompt: l(
        'What payment arrangement would better cover your material, labour, and operating costs?',
        'Wane tsarin biya ne zai fi rufe kuɗin kayanku, aikinku, da kuɗaɗen gudanarwa?',
        'Ètò ìsanwó wo ni yóò bo owó ohun èlò, iṣẹ́, àti ìnáwó iṣẹ́ yín dáadáa?',
        'Kedu nhazi ịkwụ ụgwọ ga-akwụ ụgwọ ihe ndị e ji arụ ọrụ, ọrụ aka, na mmefu ọrụ gị nke ọma?',
      ),
    },
    {
      id: 'order_risks',
      kind: 'multi',
      required: true,
      prompt: l(
        'What problems could prevent you from completing an order successfully through IPILE?',
        'Waɗanne matsaloli ne za su iya hana ku kammala oda cikin nasara ta IPILE?',
        'Àwọn ìṣòro wo ló lè dí yín lọ́wọ́ láti parí àṣẹ ní àṣeyọrí nípasẹ̀ IPILE?',
        'Kedu nsogbu nwere ike igbochi gị imecha ọda nke ọma site na IPILE?',
      ),
      help: l('Choose all that apply.', 'Zaɓi duk waɗanda suka dace.', 'Ẹ yan gbogbo èyí tó bá yẹ.', 'Họrọ ihe niile dabara.'),
      options: [
        { id: 'measurements', label: l('Inaccurate customer measurements', 'Ma’aunan abokin ciniki marasa daidai', 'Ìwọ̀n oníbàárà tí kò péye', 'Nha onye ahịa na-ezighị ezi') },
        { id: 'requirements', label: l('Unclear design requirements', 'Buƙatun zane marasa bayyana', 'Ìbéèrè àwòṣe tí kò ṣe kedere', 'Ihe a chọrọ n’ụdị na-edoghị anya') },
        { id: 'fabric', label: l('Fabric arriving late or being insufficient', 'Yadi ya iso a makare ko bai isa ba', 'Aṣọ tó dé pẹ́ tàbí tí kò tó', 'Akwa na-abịa n’oge na-adịghị mma ma ọ bụ na-ezughị') },
        { id: 'deadlines', label: l('Unrealistic deadlines', 'Wa’adin da ba zai yiwu ba', 'Ọjọ́ ìparí tí kò ṣeé ṣe', 'Oge njedebe na-enweghị ike ime') },
        { id: 'changes', label: l('Changes requested after production begins', 'Canje-canjen da aka nema bayan fara aiki', 'Àyípadà tí a béèrè lẹ́yìn tí iṣẹ́ ti bẹ̀rẹ̀', 'Mgbanwe a rịọrọ mgbe ọrụ malitere') },
        { id: 'disputes', label: l('Payment or delivery disputes', 'Rikicin biya ko isarwa', 'Aáwọ̀ ìsanwó tàbí ìfijíṣẹ́', 'Esemokwu ịkwụ ụgwọ ma ọ bụ nnyefe') },
        { id: 'capacity', label: l('Too many orders for my capacity', 'Oda sun yi yawa fiye da ƙarfina', 'Àṣẹ tó pọ̀ ju agbára mi lọ', 'Ọda karịrị ike m') },
        other(),
      ],
    },
    {
      id: 'dispute_trust',
      kind: 'text',
      required: true,
      prompt: l(
        'What would make you trust IPILE to protect you when a customer disputes the quality of your work, delays confirmation, or requests changes after completion?',
        'Me zai sa ku amince IPILE zai kare ku idan abokin ciniki ya yi jayayya kan ingancin aikinku, ya jinkirta tabbatarwa, ko ya nemi canje-canje bayan kammalawa?',
        'Kí ni yóò mú kí ẹ gbẹ́kẹ̀lé pé IPILE yóò dáàbò bò yín nígbà tí oníbàárà bá ń jiyàn nípa dídára iṣẹ́ yín, tí ó fa ìfìdímúlẹ̀ sẹ́yìn, tàbí tí ó béèrè àyípadà lẹ́yìn ìparí?',
        'Gịnị ga-eme ka i tụkwasị IPILE obi na ọ ga-echebe gị mgbe onye ahịa na-arụ ụka gbasara ịdị mma ọrụ gị, na-egbu oge ịkwado, ma ọ bụ na-arịọ mgbanwe mgbe emechara?',
      ),
    },
    {
      id: 'improvements',
      kind: 'list',
      items: 3,
      required: true,
      prompt: l(
        'What three improvements would make IPILE more effective at helping you attract customers, manage your work, and earn more from tailoring?',
        'Waɗanne ingantawa uku ne za su sa IPILE ya fi tasiri wajen taimaka muku jawo abokan ciniki, sarrafa aikinku, da samun ƙarin kuɗi daga ɗinki?',
        'Àwọn àtúnṣe mẹ́ta wo ni yóò mú kí IPILE túbọ̀ ràn yín lọ́wọ́ láti fa oníbàárà mọ́ra, ṣàkóso iṣẹ́ yín, kí ẹ sì jèrè sí i láti inú ìránṣọ?',
        'Kedu mmezi atọ ga-eme ka IPILE nyere gị aka nke ọma ịdọta ndị ahịa, jikwaa ọrụ gị, ma nweta ego karịa site n’ịkwa akwa?',
      ),
      help: TOP_THREE_HELP,
    },
  ],
};
