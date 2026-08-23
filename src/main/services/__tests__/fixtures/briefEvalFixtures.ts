// === FILE PURPOSE ===
// Synthetic evaluation fixtures for the brief extraction pipeline (BRIEF-QUAL.1
// Task 5). EVERY name, company, product and transcript line here is INVENTED —
// a fictional B2B analytics company ("Kestrel Analytics") with fictional systems
// ("Falcon Sync", "Meridian Ledger", "Atlas Console", "Compass API", "Nightwatch",
// "Beacon"), a fictional vendor ("Stratoform Cloud") and fictional people.
//
// NEVER paste a real transcript here, and never add any name or company from a
// real meeting — see STORY-5.md's forbidden-name list, which the orchestrator
// greps for as a non-vacuity control. See memory `feedback-no-real-meeting-data`.
//
// The LONG fixture is built PROGRAMMATICALLY from small topic/decision/commitment
// tables (buildLongFixture below): each row's title/statement/task string is both
// (a) the literal, verbatim substring embedded in the transcript segment(s) that
// discuss it, and (b) the ground-truth value scored against — so the transcript
// and the ground truth cannot drift apart. Generic filler lines (no ground-truth
// content) pad the meeting to a realistic length; they carry no scored content.
//
// scoreStructure() is a pure, case- and diacritic-insensitive matcher (NFD, strip
// combining marks) usable by both the mocked plumbing test and the gated live eval.
//
// === DEPENDENCIES ===
// None — deliberately dependency-free (no zod, no production imports) so this
// fixture can be imported by any test without pulling in main-process modules.

// ---------------------------------------------------------------------------
// Ground-truth shapes (BRIEF-QUAL.1 Task 5 contract)
// ---------------------------------------------------------------------------

export type FixtureRosterSource = 'participants';

export interface FixtureRosterEntry {
  name: string;
  source: FixtureRosterSource;
}

export interface FixtureTopicTruth {
  title: string;
  forms: string[];
}

export interface FixtureDecisionTruth {
  statement: string;
  forms: string[];
}

export interface FixtureCommitmentTruth {
  owner: string | null;
  task: string;
  forms: string[];
}

export interface FixtureTruth {
  roster: FixtureRosterEntry[];
  topics: FixtureTopicTruth[];
  decisions: FixtureDecisionTruth[];
  commitments: FixtureCommitmentTruth[];
  /** Task text of every commitment with `owner: null` — no explicit owner said. */
  firstPersonTasks: string[];
}

/** One segment as extractMeetingStructure's ExtractionInput expects. */
export interface FixtureSegment {
  startTime: number;
  content: string;
}

export interface EvalFixture {
  segments: FixtureSegment[];
  truth: FixtureTruth;
}

// ---------------------------------------------------------------------------
// Long-fixture content tables
// ---------------------------------------------------------------------------

interface TopicRow {
  title: string;
  forms: string[];
  lang: 'cs' | 'en';
  segments: string[];
}

interface DecisionRow {
  topicIndex: number;
  statement: string;
  forms: string[];
  segments: string[];
}

interface CommitmentRow {
  topicIndex: number;
  owner: string | null;
  task: string;
  forms: string[];
  segment: string;
}

const LONG_ROSTER: FixtureRosterEntry[] = [
  { name: 'Jirka Novák', source: 'participants' },
  { name: 'Petra Dvořáková', source: 'participants' },
  { name: 'Milan Beneš', source: 'participants' },
  { name: 'Zuzana Krejčí', source: 'participants' },
  { name: 'Filip Sedláček', source: 'participants' },
  { name: 'Eva Malá', source: 'participants' },
];

// Fourteen topics (>= 12 required). Index 0 (Falcon Sync) is deliberately the one
// restated near the end of the meeting (see buildRecapSegments) to exercise
// cross-chunk merge collapsing on a REAL extraction run, not just a unit test.
const LONG_TOPICS: TopicRow[] = [
  {
    title: 'noční pipeline Falcon Sync zase padal pro velké zákazníky',
    forms: [
      'noční pipeline Falcon Sync zase padal pro velké zákazníky',
      'Falcon Sync nightly pipeline failures for large tenants',
    ],
    lang: 'cs',
    segments: [
      'Tak první bod - noční pipeline Falcon Sync zase padal pro velké zákazníky, druhou noc po sobě.',
      'Padá to jenom u účtů s víc než pěti tisíci řádky, takže podezíráme batch limit, ne celý worker.',
    ],
  },
  {
    title: 'chyba v zaokrouhlování Meridian Ledgeru',
    forms: ['chyba v zaokrouhlování Meridian Ledgeru', 'Meridian Ledger billing rounding bug'],
    lang: 'cs',
    segments: [
      'Další bod - chyba v zaokrouhlování Meridian Ledgeru, na kterou si stěžují dva enterprise zákazníci.',
      'Součty se liší o pár centů oproti tomu, co mají zákazníci ve svém účetnictví, takže to vypadá špatně navenek.',
    ],
  },
  {
    title: 'harmonogram redesignu Atlas Console',
    forms: ['harmonogram redesignu Atlas Console', 'Atlas Console redesign timeline'],
    lang: 'cs',
    segments: [
      'Bod tři - harmonogram redesignu Atlas Console, potřebujeme se bavit o možném posunu termínu.',
      'Tým designu narazil na problémy s kontrastem barev, které musí projít accessibility review.',
    ],
  },
  {
    title: 'migrace Compass API v3 na GraphQL',
    forms: ['migrace Compass API v3 na GraphQL', 'Compass API v3 GraphQL migration'],
    lang: 'cs',
    segments: [
      'Čtvrtý bod - migrace Compass API v3 na GraphQL, jak to vypadá s výkonem resolverů.',
      'Resolver pro billing dělá zbytečně moc dotazů do databáze, budeme potřebovat DataLoader.',
    ],
  },
  {
    title: 'únava z alertů Nightwatch',
    forms: ['únava z alertů Nightwatch', 'Nightwatch alert fatigue'],
    lang: 'cs',
    segments: [
      'Pátý bod - únava z alertů Nightwatch, on-call lidi si stěžují, že alertů je zbytečně moc.',
      'Reálné incidenty se ztrácí v šumu, protože posílá alerty i na věci, co se samy opraví za minutu.',
    ],
  },
  {
    title: 'zpoždění notifikací Beacon',
    forms: ['zpoždění notifikací Beacon', 'Beacon notification delivery delays'],
    lang: 'cs',
    segments: [
      'Šestý bod - zpoždění notifikací Beacon, hlavně u evropských zákazníků.',
      'Push notifikace chodí s deseti až patnáctiminutovým zpožděním, e-maily jsou v pořádku a chodí hned.',
    ],
  },
  {
    title: 'zjednodušení onboarding flow',
    forms: ['zjednodušení onboarding flow', 'onboarding flow simplification'],
    lang: 'cs',
    segments: [
      'Sedmý bod - zjednodušení onboarding flow pro nové zákazníky, teď je moc dlouhý.',
      'Noví uživatelé odpadají hlavně na kroku s propojením platebních údajů, tam ztrácíme nejvíc lidí.',
    ],
  },
  {
    title: 'plán náboru na Q3 pro platform tým',
    forms: ['plán náboru na Q3 pro platform tým', 'Q3 hiring plan for the platform team'],
    lang: 'cs',
    segments: [
      'Osmý bod - plán náboru na Q3 pro platform tým, potřebujeme posílit kapacitu.',
      'Potřebujeme dva nové backend inženýry a jednoho SRE, rozpočet na to už je schválený.',
    ],
  },
  {
    title: 'restrukturalizace on-call rotace',
    forms: ['restrukturalizace on-call rotace', 'on-call rotation restructuring'],
    lang: 'cs',
    segments: [
      'Devátý bod - restrukturalizace on-call rotace, současný model je podle mě nefér.',
      'Dva lidi mají dvakrát víc směn než zbytek týmu, potřebujeme to konečně vyvážit mezi všechny.',
    ],
  },
  {
    title: 'aktualizace politiky uchovávání dat DPA-7',
    forms: ['aktualizace politiky uchovávání dat DPA-7', 'DPA-7 data retention policy update'],
    lang: 'cs',
    segments: [
      'Desátý bod - aktualizace politiky uchovávání dat DPA-7, právní tým to po nás chce.',
      'Právní tým chce zkrátit dobu uchovávání transkriptů z pěti let na dva roky kvůli nové regulaci.',
    ],
  },
  {
    title: 'restrukturalizace cenových úrovní',
    forms: ['restrukturalizace cenových úrovní', 'pricing tier restructuring'],
    lang: 'cs',
    segments: [
      'Jedenáctý bod - restrukturalizace cenových úrovní, chceme přidat čtvrtou úroveň.',
      'Zákazníci ze středního segmentu si stěžují, že skok mezi druhou a třetí úrovní je moc velký.',
    ],
  },
  {
    title: 'obnovení smlouvy s dodavatelem Stratoform Cloud',
    forms: ['obnovení smlouvy s dodavatelem Stratoform Cloud', 'Stratoform Cloud vendor contract renewal'],
    lang: 'cs',
    segments: [
      'Dvanáctý bod - obnovení smlouvy s dodavatelem Stratoform Cloud, končí nám za dva měsíce.',
      'Oznámili zvýšení cen od čtvrtého kvartálu, takže se nám vyplatí podepsat radši dřív.',
    ],
  },
  {
    title: 'migrace interní wiki na nový nástroj',
    forms: ['migrace interní wiki na nový nástroj', 'internal wiki migration to a new docs tool'],
    lang: 'cs',
    segments: [
      'Třináctý bod - migrace interní wiki na nový nástroj pro dokumentaci.',
      'Starý nástroj končí s podporou na konci roku, takže musíme přesunout obsah včas, ne na poslední chvíli.',
    ],
  },
  {
    title: 'roadmap review with a visiting exec',
    forms: ['roadmap review with a visiting exec', 'Q4 roadmap review with the visiting executive'],
    lang: 'en',
    segments: [
      'Last topic before we wrap up the local items - the roadmap review with a visiting exec next week.',
      'She wants a fifteen-minute walkthrough of the platform roadmap plus the open risks for Q4.',
    ],
  },
];

// Seven decisions (>= 6 required), each with a rationale sentence.
const LONG_DECISIONS: DecisionRow[] = [
  {
    topicIndex: 0,
    statement: 'zvednout batch limit Falcon Syncu na pět tisíc záznamů',
    forms: [
      'zvednout batch limit Falcon Syncu na pět tisíc záznamů',
      'raise the Falcon Sync batch limit to 5000 records',
    ],
    segments: [
      'Rozhodli jsme se zvednout batch limit Falcon Syncu na pět tisíc záznamů.',
      'Je to levnější než celý worker přepisovat, a postihuje to jenom pár velkých účtů, ne většinu zákazníků.',
    ],
  },
  {
    topicIndex: 1,
    statement: 'přepnout Meridian Ledger na bankéřské zaokrouhlování',
    forms: ['přepnout Meridian Ledger na bankéřské zaokrouhlování', "switch Meridian Ledger to banker's rounding"],
    segments: [
      'Rozhodli jsme se přepnout Meridian Ledger na bankéřské zaokrouhlování.',
      'Odpovídá to účetnímu standardu a mělo by to zastavit stížnosti na drift o pár centů.',
    ],
  },
  {
    topicIndex: 2,
    statement: 'posunout launch redesignu Atlas Console z P2 na P3',
    forms: [
      'posunout launch redesignu Atlas Console z P2 na P3',
      'push the Atlas Console redesign launch from P2 to P3',
    ],
    segments: [
      'Rozhodli jsme se posunout launch redesignu Atlas Console z P2 na P3.',
      'Accessibility review našel problémy s kontrastem, které potřebují víc času na doladění designu.',
    ],
  },
  {
    topicIndex: 3,
    statement: 'zmrazit Compass API v2 na dalších šest měsíců po vydání v3',
    forms: [
      'zmrazit Compass API v2 na dalších šest měsíců po vydání v3',
      'freeze Compass API v2 for six more months after v3 ships',
    ],
    segments: [
      'Rozhodli jsme se zmrazit Compass API v2 na dalších šest měsíců po vydání v3.',
      'Dává to velkým zákazníkům dost času na migraci, než starou verzi vypneme úplně.',
    ],
  },
  {
    topicIndex: 4,
    statement: 'snížit prahové hodnoty alertů Nightwatch na polovinu',
    forms: ['snížit prahové hodnoty alertů Nightwatch na polovinu', 'cut Nightwatch alert thresholds in half'],
    segments: [
      'Rozhodli jsme se snížit prahové hodnoty alertů Nightwatch na polovinu.',
      'Současný šum způsobuje únavu on-call týmu a lidi kvůli tomu přehlíží skutečné incidenty.',
    ],
  },
  {
    topicIndex: 10,
    statement: 'přejít na čtyři cenové úrovně místo tří',
    forms: ['přejít na čtyři cenové úrovně místo tří', 'move pricing to four tiers instead of three'],
    segments: [
      'Rozhodli jsme se přejít na čtyři cenové úrovně místo tří.',
      'Zákazníci ze středního segmentu se cítí skokem mezi druhou a třetí úrovní odstrčení.',
    ],
  },
  {
    topicIndex: 11,
    statement: 'obnovit smlouvu se Stratoform Cloud na dva roky místo jednoho',
    forms: [
      'obnovit smlouvu se Stratoform Cloud na dva roky místo jednoho',
      'renew the Stratoform Cloud contract for two years instead of one',
    ],
    segments: [
      'Rozhodli jsme se obnovit smlouvu se Stratoform Cloud na dva roky místo jednoho.',
      'Zamkne nám to současné ceny ještě před jejich zvýšením ve čtvrtém kvartálu.',
    ],
  },
];

// Eighteen commitments: 15 with a named owner (across the 6-person roster) plus
// 3 first-person items with NO explicit owner (index 3, 7 and 17 below). Index 0
// is Jirka's Falcon Sync fix — the one restated near the end of the meeting.
// Dative ("Jirkovi", "Milanovi", "Filipovi") and instrumental ("s Jirkou")
// declensions of roster names are used deliberately in several segments; the
// ground-truth `owner` always stays the roster's own nominative spelling.
const LONG_COMMITMENTS: CommitmentRow[] = [
  {
    topicIndex: 0,
    owner: 'Jirka Novák',
    task: 'opravit batch limit Falcon Syncu a znovu nasadit worker',
    forms: [
      'opravit batch limit Falcon Syncu a znovu nasadit worker',
      'patch the Falcon Sync batch limit and redeploy the worker',
    ],
    segment: 'Jirkovi zůstává úkol opravit batch limit Falcon Syncu a znovu nasadit worker, do pátku. Je to P2.',
  },
  {
    topicIndex: 0,
    owner: 'Jirka Novák',
    task: 'napsat postmortem dokument k incidentu Falcon Syncu',
    forms: ['napsat postmortem dokument k incidentu Falcon Syncu', 'write the Falcon Sync incident postmortem'],
    segment: 'Jirka má ještě za úkol napsat postmortem dokument k incidentu Falcon Syncu, do příští středy.',
  },
  {
    topicIndex: 0,
    owner: 'Jirka Novák',
    task: 'spárovat se s Filipem na výkonu resolveru Compass API v3',
    forms: [
      'spárovat se s Filipem na výkonu resolveru Compass API v3',
      'pair with Filip on the Compass API v3 resolver performance',
    ],
    segment:
      'S Jirkou jsme se domluvili na úkolu spárovat se s Filipem na výkonu resolveru Compass API v3, do konce sprintu.',
  },
  {
    topicIndex: 0,
    owner: null,
    task: 'zablokovat si dvě hodiny denně na ladění Falcon Syncu tento týden',
    forms: [
      'zablokovat si dvě hodiny denně na ladění Falcon Syncu tento týden',
      'Zablokuju si dvě hodiny denně na ladění Falcon Syncu tento týden',
      "I'll block two hours daily for Falcon Sync debugging this week",
    ],
    segment:
      'Beru si za úkol zablokovat si dvě hodiny denně na ladění Falcon Syncu tento týden, ať to máme pod kontrolou.',
  },
  {
    topicIndex: 1,
    owner: 'Petra Dvořáková',
    task: 'nasadit opravu zaokrouhlování Meridian Ledgeru na staging',
    forms: [
      'nasadit opravu zaokrouhlování Meridian Ledgeru na staging',
      'ship the Meridian Ledger rounding fix to staging',
    ],
    segment: 'Petra má za úkol nasadit opravu zaokrouhlování Meridian Ledgeru na staging, do pondělí. Je to P2.',
  },
  {
    topicIndex: 1,
    owner: 'Petra Dvořáková',
    task: 'aktualizovat šablonu reportu pro účetní odsouhlasení',
    forms: [
      'aktualizovat šablonu reportu pro účetní odsouhlasení',
      'update the billing reconciliation report template',
    ],
    segment: 'Petra má za úkol aktualizovat šablonu reportu pro účetní odsouhlasení, do konce měsíce.',
  },
  {
    topicIndex: 10,
    owner: 'Petra Dvořáková',
    task: 'napsat copy pro stránku se čtyřmi cenovými úrovněmi',
    forms: ['napsat copy pro stránku se čtyřmi cenovými úrovněmi', 'draft the four-tier pricing page copy'],
    segment: 'Petra má za úkol napsat copy pro stránku se čtyřmi cenovými úrovněmi, do příštího úterý.',
  },
  {
    topicIndex: 10,
    owner: null,
    task: 'připravit podklady pro cenovou prezentaci pro obchodní tým',
    forms: [
      'připravit podklady pro cenovou prezentaci pro obchodní tým',
      'prepare materials for the pricing presentation for the sales team',
    ],
    segment: 'Beru si za úkol připravit podklady pro cenovou prezentaci pro obchodní tým, do čtvrtka.',
  },
  {
    topicIndex: 2,
    owner: 'Milan Beneš',
    task: 'předělat onboarding checklist v Atlas Console',
    forms: ['předělat onboarding checklist v Atlas Console', 'redesign the Atlas Console onboarding checklist'],
    segment: 'Milan má za úkol předělat onboarding checklist v Atlas Console, do tří týdnů.',
  },
  {
    topicIndex: 2,
    owner: 'Milan Beneš',
    task: 'projít zjištění z accessibility auditu s design týmem',
    forms: [
      'projít zjištění z accessibility auditu s design týmem',
      'review the accessibility audit findings with the design team',
    ],
    segment: 'Milanovi zůstává úkol projít zjištění z accessibility auditu s design týmem, do čtvrtka.',
  },
  {
    topicIndex: 8,
    owner: 'Milan Beneš',
    task: 'nastavit nový rozpis on-call rotace v nástroji',
    forms: ['nastavit nový rozpis on-call rotace v nástroji', 'set up the new on-call rotation schedule in the tool'],
    segment: 'Milan má za úkol nastavit nový rozpis on-call rotace v nástroji, do příštího pátku.',
  },
  {
    topicIndex: 4,
    owner: 'Zuzana Krejčí',
    task: 'snížit prahové hodnoty v konfiguraci Nightwatch a nasadit to',
    forms: [
      'snížit prahové hodnoty v konfiguraci Nightwatch a nasadit to',
      'cut the Nightwatch alert thresholds in the config and deploy',
    ],
    segment: 'Zuzana má za úkol snížit prahové hodnoty v konfiguraci Nightwatch a nasadit to, do pátku. Je to P3.',
  },
  {
    topicIndex: 9,
    owner: 'Zuzana Krejčí',
    task: 'napsat shrnutí politiky uchovávání dat DPA-7 na wiki',
    forms: [
      'napsat shrnutí politiky uchovávání dat DPA-7 na wiki',
      'write the DPA-7 data retention policy summary for the wiki',
    ],
    segment: 'Zuzana má za úkol napsat shrnutí politiky uchovávání dat DPA-7 na wiki, do dvou týdnů.',
  },
  {
    topicIndex: 5,
    owner: 'Filip Sedláček',
    task: 'opravit zpoždění doručování notifikací Beacon pro EU zákazníky',
    forms: [
      'opravit zpoždění doručování notifikací Beacon pro EU zákazníky',
      'fix the Beacon notification delivery delay for EU tenants',
    ],
    segment:
      'Filipovi zůstává úkol opravit zpoždění doručování notifikací Beacon pro EU zákazníky, do středy. Je to P2.',
  },
  {
    topicIndex: 3,
    owner: 'Filip Sedláček',
    task: 'schválit e-mail s oznámením o zmrazení Compass API v2',
    forms: [
      'schválit e-mail s oznámením o zmrazení Compass API v2',
      'sign off on the Compass API v2 freeze announcement email',
    ],
    segment: 'Filip má za úkol schválit e-mail s oznámením o zmrazení Compass API v2, do zítřka.',
  },
  {
    topicIndex: 11,
    owner: 'Eva Malá',
    task: 'vyjednat podmínky dvouletého obnovení smlouvy se Stratoform Cloud',
    forms: [
      'vyjednat podmínky dvouletého obnovení smlouvy se Stratoform Cloud',
      'negotiate the two-year Stratoform Cloud renewal terms',
    ],
    segment: 'Eva má za úkol vyjednat podmínky dvouletého obnovení smlouvy se Stratoform Cloud, do konce měsíce.',
  },
  {
    topicIndex: 12,
    owner: 'Eva Malá',
    task: 'přesunout obsah interní wiki do nového nástroje',
    forms: [
      'přesunout obsah interní wiki do nového nástroje',
      'migrate the internal wiki content to the new docs tool',
    ],
    segment: 'Eva má za úkol přesunout obsah interní wiki do nového nástroje, do měsíce.',
  },
  {
    topicIndex: 13,
    owner: null,
    task: 'draft the roadmap deck for the exec review by next Monday',
    forms: ['draft the roadmap deck for the exec review by next Monday'],
    segment: 'I will draft the roadmap deck for the exec review by next Monday, so we have time to rehearse.',
  },
];

const OPENING_CS = [
  'Dobré ráno všem, díky že jste dorazili na dnešní quarterly review.',
  'Máme před sebou docela nabitou agendu, tak pojďme rovnou na to.',
  'Jirko, můžeš prosím sdílet obrazovku s poznámkami z minula?',
  'Jasně, sdílím, mělo by to už být vidět na všech obrazovkách.',
  'Super, vidíme to. Tak jedeme podle agendy pěkně shora dolů.',
  'Nejdřív rychle projdeme pár pojmů pro nové kolegy, co dneska poprvé sedí na tomhle meetingu.',
];

const GLOSSARY_CS = [
  'Falcon Sync je náš noční pipeline, který synchronizuje data zákazníků do Meridian Ledgeru.',
  'Meridian Ledger je naše fakturační platforma, kde se počítají všechny částky, daně a slevy.',
  'Atlas Console je administrátorský dashboard, který zákazníci používají ke správě vlastního účtu.',
  'Compass API je naše veřejné rozhraní, přes které si zákazníci tahají data programově.',
  'Nightwatch je naše monitoring a alerting služba, co nás budí, když něco v produkci selže.',
  'Beacon je notifikační služba, přes kterou posíláme e-maily a push notifikace zákazníkům.',
  'Stratoform Cloud je náš cloudový hosting vendor, u kterého máme aktuálně roční smlouvu.',
  'DPA-7 je interní zkratka pro naši politiku uchovávání dat, kterou musíme brzy aktualizovat.',
];

const CLOSING_CS = [
  'Dobře, tím jsme prošli celou agendu, díky všem za aktivní účast.',
  'Zápis pošlu do konce dne, ať máme všechny úkoly na jednom místě.',
  'Kdyby něco vyplynulo dodatečně, pište to rovnou do kanálu týmu.',
  'Příští review máme za dva týdny ve stejném čase.',
  'Díky všem, hezký zbytek dne a ať se daří s úkoly.',
];

// Generic connective filler (no ground-truth content) — cycled to pad the meeting
// to a realistic length without hand-writing hundreds of unique lines.
const FILLER_CS = [
  'Jasně, dává to smysl, akorát bychom si to měli hned zapsat, ať nám to nezapadne někde v poznámkách z callu, protože příště si to nikdo nebude pamatovat.',
  'Dobře, pojďme radši dál, máme toho na programu ještě hodně a nechci, abychom tu kvůli jednomu bodu seděli až do večera, chápu ale, že to bylo důležité probrat.',
  'Můžeš to ještě jednou zopakovat pomaleji, ať to mám určitě správně v zápisu z tohohle meetingu, ať to pak nemusíme dohledávat ze záznamu z callu?',
  'Souhlasím, myslím že bychom to měli udělat přesně takhle, dává to nejvíc smysl ze všech variant, co jsme dneska probírali, i s ohledem na kapacitu týmu.',
  'Kdo to bude mít reálně na starosti, ať víme, na koho se máme příště obrátit s dotazy k tomu, ať to nekončí zase u tebe jako obvykle?',
  'To zní rozumně, jenom bych to ještě probral s druhým týmem, než to definitivně potvrdíme všem, ať nás pak nikdo nepřekvapí nějakou závislostí.',
  'Máme na to i rozpočet už schválený, nebo to ještě musíme řešit zvlášť s financemi, než se do toho pustíme naplno příští týden?',
  'Napíšu si to do poznámek, ať na to určitě nezapomeneme, až budeme dělat zápis z meetingu a posílat ho zbytku týmu, co dneska nemohl dorazit.',
  'Je v tom podle vás ještě nějaké riziko, na které bychom měli dopředu myslet a připravit se na něj, než to půjde dál mimo náš tým?',
  'Dobrá otázka, budeme to muset ještě prověřit, než se k tomu definitivně vyjádříme na příště, ať nedáváme sliby, co pak nedodržíme.',
  'Kdy bychom to reálně mohli mít hotové, abychom to stihli ještě před koncem tohohle kvartálu, a ne až v tom příštím jako minule?',
  'Za mě rozhodně žádný problém, klidně to takhle nechme a jedeme dál v agendě na další bod, tenhle už myslím máme dostatečně probraný.',
  'Potřebujeme k tomu ještě někoho z druhého týmu, nebo to zvládneme sami interně bez pomoci a bez čekání na jejich kapacitu?',
  'Můžeme se k tomu vrátit příští týden, jestli bude potřeba víc detailů k finálnímu rozhodnutí, teď si myslím máme dost na to jet dál.',
  'Díky za shrnutí, posuneme se radši na další bod, ať stihneme dnes probrat celou agendu a nemusíme kvůli tomu prodlužovat call.',
  'To je fér, zkusíme to takhle a uvidíme, jak to bude fungovat v praxi za pár týdnů provozu, a případně to ještě doladíme podle výsledků.',
  'Ještě něco k tomuhle bodu, než půjdeme dál na další věc v agendě dnešního meetingu, nebo je to za nás definitivně uzavřené?',
  'Ne, myslím že je to jasné, klidně můžeme jít dál, nemám k tomu žádné další dotazy, díky za srozumitelné vysvětlení celé situace.',
  'Dobře, mám to zapsáno, přesuneme se teda rovnou na další bod z dnešní agendy, ať se dostaneme na konec ještě dnes.',
  'Tohle bude ještě chtít sladit s druhým týmem, ať kvůli tomu nejedeme každý úplně jinam a nemusíme to pak zpětně opravovat.',
  'Rozumím, dává to logiku v kontextu toho, co jsme řešili minulý týden na retru s celým týmem, takže to na sebe hezky navazuje.',
  'Jenom pro jistotu, máme na tohle dostatek lidí, nebo budeme muset sehnat pomoc zvenčí, třeba i na omezenou dobu jednoho sprintu?',
  'Super, tohle vypadá jako dobrý plán, jedeme rovnou dál na další bod dnešní agendy, ať to dnes celé stihneme probrat do konce.',
  'Chápu, dává to logiku, hlavně ať to nezdrží ostatní věci, co na tomhle rozhodnutí závisí, protože jich je docela dost.',
];

const FILLER_EN = [
  'Sounds good to me, let us just make sure it is written down properly for the notes so nobody has to dig through the recording later.',
  'Let us keep this section tight, fifteen minutes max, we still have a lot on the agenda today and I would rather not run over time.',
  'I can share the current deck as a starting point, should save us some time preparing it instead of starting from a blank slide.',
  'Works for me, no objections from my side on that one, sounds like a reasonable way to handle it given everything else going on.',
  'Any concerns before we move on to the next item on the agenda, or are we good to keep going through the rest of the list?',
  'Nothing from my side, happy to move on whenever everyone else is ready, this part seems pretty well covered already.',
  'That timeline should be fine, but let us double check with the rest of the team first before we commit to it publicly.',
  'Let us make sure the numbers are up to date before the call with the visiting exec, do not want any surprises in that room.',
  'I will loop in the design lead as well, they should probably see this before we finalize it and lock the direction in.',
  'Good point, let us flag that as a risk and revisit it once we have more information from the rest of the team.',
  'We can revisit that after the exec review, it is not blocking anything today so there is no rush to decide right now.',
  'Agreed, let us park that for now and come back to it once the roadmap is locked and we have more clarity overall.',
  'I will send the invite once the deck is ready, should be later this afternoon if nothing else comes up before then.',
  'Let us double check the Q4 numbers with finance before we put them in the deck, better safe than presenting something wrong.',
  'That works, thanks for flagging it, glad we caught it before the review instead of during the actual meeting.',
  'I think that covers it for this part, let us keep moving through the rest of the agenda before we run out of time.',
  'Perfect, noted, moving on to the next item then, this one sounds like it is in good shape for now.',
  'Great, let us move to the recap before we wrap up for today, want to make sure everything is captured properly.',
];

const SEGMENT_SPACING_MS = 10_000;
const TARGET_LONG_SEGMENTS = 520;

function fillerBlock(pool: string[], count: number, offset: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pool[(offset + i) % pool.length]);
  return out;
}

/** Restates topic 0 and commitment 0 verbatim near the end of the meeting — the
 *  two deliberate near-duplicates a real (or mocked) extraction run must collapse
 *  back to one item each via briefExtractionService's mergeDrafts. Built from the
 *  SAME rows the transcript and truth already derive from, so it cannot drift. */
function buildRecapSegments(): string[] {
  const topic = LONG_TOPICS[0];
  const commitment = LONG_COMMITMENTS[0];
  return [
    `Ještě rychlá rekapitulace - ${topic.title}, chtěl jsem to mít jasně zapsané v zápisu z meetingu.`,
    `A pro jistotu zopakuju - Jirkovi zůstává úkol ${commitment.task}, do pátku.`,
  ];
}

function assembleLongContent(fillerPerCluster: number): string[] {
  const content: string[] = [...OPENING_CS, ...GLOSSARY_CS];
  LONG_TOPICS.forEach((topic, i) => {
    content.push(...topic.segments);
    LONG_DECISIONS.filter((d) => d.topicIndex === i).forEach((d) => content.push(...d.segments));
    LONG_COMMITMENTS.filter((c) => c.topicIndex === i).forEach((c) => content.push(c.segment));
    if (fillerPerCluster > 0) {
      const pool = topic.lang === 'en' ? FILLER_EN : FILLER_CS;
      content.push(...fillerBlock(pool, fillerPerCluster, i * 5));
    }
  });
  content.push(...buildRecapSegments(), ...CLOSING_CS);
  return content;
}

function buildTruth(
  roster: FixtureRosterEntry[],
  topics: TopicRow[],
  decisions: DecisionRow[],
  commitments: CommitmentRow[],
): FixtureTruth {
  const commitmentTruths = commitments.map((c) => ({ owner: c.owner, task: c.task, forms: c.forms }));
  return {
    roster,
    topics: topics.map((t) => ({ title: t.title, forms: t.forms })),
    decisions: decisions.map((d) => ({ statement: d.statement, forms: d.forms })),
    commitments: commitmentTruths,
    firstPersonTasks: commitmentTruths.filter((c) => c.owner === null).map((c) => c.task),
  };
}

/** The long fixture's ground-truth ROWS (not just the trimmed truth shape) —
 *  exported so a test's mocked `generate()` can synthesize a per-part draft by
 *  detecting which rows' anchor text appears in that call's prompt. */
export interface LongFixture extends EvalFixture {
  topics: TopicRow[];
  decisions: DecisionRow[];
  commitments: CommitmentRow[];
}

function buildLongFixture(): LongFixture {
  const bare = assembleLongContent(0);
  const fillerNeeded = Math.max(0, TARGET_LONG_SEGMENTS - bare.length);
  const perCluster = Math.ceil(fillerNeeded / LONG_TOPICS.length);
  const content = assembleLongContent(perCluster);
  const segments = content.map((text, i) => ({ startTime: i * SEGMENT_SPACING_MS, content: text }));
  return {
    segments,
    truth: buildTruth(LONG_ROSTER, LONG_TOPICS, LONG_DECISIONS, LONG_COMMITMENTS),
    topics: LONG_TOPICS,
    decisions: LONG_DECISIONS,
    commitments: LONG_COMMITMENTS,
  };
}

export const LONG_FIXTURE: LongFixture = buildLongFixture();

// ---------------------------------------------------------------------------
// Short fixture — asserts the pipeline does not pad a small meeting.
// ---------------------------------------------------------------------------

const SHORT_ROSTER: FixtureRosterEntry[] = [
  { name: 'Jirka Novák', source: 'participants' },
  { name: 'Petra Dvořáková', source: 'participants' },
];

const SHORT_TOPICS: TopicRow[] = [
  {
    title: 'rychlá kontrola nasazení opravy Meridian Ledgeru',
    forms: ['rychlá kontrola nasazení opravy Meridian Ledgeru', 'quick check on the Meridian Ledger fix deployment'],
    lang: 'cs',
    segments: [
      'Dobré ráno, dnešní call bude krátký - rychlá kontrola nasazení opravy Meridian Ledgeru.',
      'Nasadili jsme to včera večer, zatím žádné nové stížnosti na zaokrouhlení nepřišly.',
    ],
  },
  {
    title: 'příprava na zítřejší demo pro zákazníka',
    forms: ['příprava na zítřejší demo pro zákazníka', "prep for tomorrow's customer demo"],
    lang: 'cs',
    segments: [
      'Druhý bod - příprava na zítřejší demo pro zákazníka, chceme ukázat nový dashboard.',
      'Zákazník chce vidět hlavně reporting a export dat, tak se na to zaměříme v první půlce.',
    ],
  },
];

const SHORT_DECISIONS: DecisionRow[] = [
  {
    topicIndex: 0,
    statement: 'označit incident s Meridian Ledgerem jako vyřešený',
    forms: ['označit incident s Meridian Ledgerem jako vyřešený', 'mark the Meridian Ledger incident as resolved'],
    segments: [
      'Rozhodli jsme se označit incident s Meridian Ledgerem jako vyřešený.',
      'Žádné nové stížnosti čtyřiadvacet hodin po nasazení, takže to už můžeme zavřít.',
    ],
  },
];

const SHORT_COMMITMENTS: CommitmentRow[] = [
  {
    topicIndex: 0,
    owner: 'Jirka Novák',
    task: 'zkontrolovat logy po nasazení opravy Meridian Ledgeru',
    forms: [
      'zkontrolovat logy po nasazení opravy Meridian Ledgeru',
      'check the logs after the Meridian Ledger fix deployment',
    ],
    segment: 'Jirka má za úkol zkontrolovat logy po nasazení opravy Meridian Ledgeru, ještě dnes.',
  },
  {
    topicIndex: 1,
    owner: 'Petra Dvořáková',
    task: 'připravit demo prostředí pro zítřejší ukázku zákazníkovi',
    forms: [
      'připravit demo prostředí pro zítřejší ukázku zákazníkovi',
      "prepare the demo environment for tomorrow's customer walkthrough",
    ],
    segment: 'Petra má za úkol připravit demo prostředí pro zítřejší ukázku zákazníkovi, do večera.',
  },
];

const SHORT_OPENING = ['Dobré ráno, díky že jste se stihli připojit i na tenhle kratší call.'];
const SHORT_CLOSING = ['Díky všem, to je ode mě dnes všechno, hezký zbytek dne.'];
const SHORT_SPACING_MS = 53_000;

function buildShortFixture(): LongFixture {
  const content: string[] = [...SHORT_OPENING];
  SHORT_TOPICS.forEach((topic, i) => {
    content.push(...topic.segments);
    SHORT_DECISIONS.filter((d) => d.topicIndex === i).forEach((d) => content.push(...d.segments));
    SHORT_COMMITMENTS.filter((c) => c.topicIndex === i).forEach((c) => content.push(c.segment));
  });
  content.push(...SHORT_CLOSING);
  const segments = content.map((text, i) => ({ startTime: i * SHORT_SPACING_MS, content: text }));
  return {
    segments,
    truth: buildTruth(SHORT_ROSTER, SHORT_TOPICS, SHORT_DECISIONS, SHORT_COMMITMENTS),
    topics: SHORT_TOPICS,
    decisions: SHORT_DECISIONS,
    commitments: SHORT_COMMITMENTS,
  };
}

export const SHORT_FIXTURE: LongFixture = buildShortFixture();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScorableStructure {
  topics: { title: string }[];
  decisions: { statement: string }[];
  commitments: { owner: string | null; task: string }[];
}

export interface ScoreResult {
  topicsRecall: number;
  decisionsRecall: number;
  commitmentsRecall: number;
  inventedOwners: number;
  wrongOwners: number;
  matched: { topics: string[]; decisions: string[]; commitments: string[] };
  missed: { topics: string[]; decisions: string[]; commitments: string[] };
}

/** Lowercase, NFD-strip combining diacritical marks, drop light punctuation,
 *  collapse whitespace. The shared normalization for every comparison below. */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,;:!?"'`()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `text` matches any accepted form — equal, or one containing the
 *  other, after normalization (tolerates minor paraphrase/punctuation drift
 *  from a real model while still requiring most of the content to agree). */
function matchesAnyForm(text: string, forms: string[]): boolean {
  const norm = normalizeText(text);
  if (!norm) return false;
  return forms.some((form) => {
    const f = normalizeText(form);
    return f.length > 0 && (norm === f || norm.includes(f) || f.includes(norm));
  });
}

function isKnownRosterName(name: string, roster: FixtureRosterEntry[]): boolean {
  const norm = normalizeText(name);
  return roster.some((entry) => normalizeText(entry.name) === norm);
}

function recallOf<T, S>(
  truthItems: T[],
  structureItems: S[],
  truthLabel: (t: T) => string,
  truthForms: (t: T) => string[],
  structureField: (s: S) => string,
) {
  const matched: string[] = [];
  const missed: string[] = [];
  for (const item of truthItems) {
    const hit = structureItems.some((s) => matchesAnyForm(structureField(s), truthForms(item)));
    (hit ? matched : missed).push(truthLabel(item));
  }
  const recall = truthItems.length === 0 ? 1 : matched.length / truthItems.length;
  return { recall, matched, missed };
}

/**
 * Score an extracted structure against fixture ground truth. Pure and total —
 * safe to call from both the mocked plumbing test and the gated live eval.
 */
export function scoreStructure(structure: ScorableStructure, truth: FixtureTruth): ScoreResult {
  const topics = recallOf(
    truth.topics,
    structure.topics,
    (t) => t.title,
    (t) => t.forms,
    (s) => s.title,
  );
  const decisions = recallOf(
    truth.decisions,
    structure.decisions,
    (d) => d.statement,
    (d) => d.forms,
    (s) => s.statement,
  );
  const commitments = recallOf(
    truth.commitments,
    structure.commitments,
    (c) => c.task,
    (c) => c.forms,
    (s) => s.task,
  );

  const inventedOwners = structure.commitments.filter(
    (c) => c.owner !== null && !isKnownRosterName(c.owner, truth.roster),
  ).length;
  const wrongOwners = structure.commitments.filter(
    (c) => c.owner !== null && truth.firstPersonTasks.some((task) => matchesAnyForm(c.task, [task])),
  ).length;

  return {
    topicsRecall: topics.recall,
    decisionsRecall: decisions.recall,
    commitmentsRecall: commitments.recall,
    inventedOwners,
    wrongOwners,
    matched: { topics: topics.matched, decisions: decisions.matched, commitments: commitments.matched },
    missed: { topics: topics.missed, decisions: decisions.missed, commitments: commitments.missed },
  };
}

/**
 * Recall of `items` against a block of PROSE (e.g. a rendered markdown brief),
 * using the exact same case-/diacritic-insensitive form matching scoreStructure
 * uses internally — so the live eval's secondary "writer recall" number is
 * produced by the same matcher as the primary structural recall, never a
 * second one. Pure and total; `items.length === 0` reports full recall.
 */
export function proseRecall(text: string, items: { forms: string[] }[]): number {
  if (items.length === 0) return 1;
  const hits = items.filter((item) => matchesAnyForm(text, item.forms)).length;
  return hits / items.length;
}
