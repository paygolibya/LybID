// Real, human-written copy in both languages — not machine-translated.
// Arabic is the default (see i18n.tsx): this site is built for Libyan
// banks and fintechs first, with English as the secondary audience
// (foreign compliance officers, regional partners).

export interface Dictionary {
  nav: {
    product: string;
    solutions: string;
    why: string;
    pricing: string;
    signIn: string;
    cta: string;
  };
  hero: {
    eyebrow: string;
    headline: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    note: string;
    card: {
      sample: string;
      brand: string;
      docLabel: string;
      docValue: string;
      liveLabel: string;
      liveValue: string;
      stateLabel: string;
      stateValue: string;
      seal: string;
    };
  };
  features: {
    eyebrow: string;
    heading: string;
    sub: string;
    items: { title: string; body: string }[];
  };
  solutions: {
    eyebrow: string;
    heading: string;
    sub: string;
    filters: string[];
    kyc: { label: string; tag: string; items: string[] };
    kyb: { label: string; tag: string; items: string[] };
    note: string;
  };
  why: {
    eyebrow: string;
    heading: string;
    items: { title: string; body: string }[];
  };
  pricing: {
    eyebrow: string;
    heading: string;
    sub: string;
    unit: string;
    basic: {
      badge: string;
      name: string;
      desc: string;
      items: string[];
      cta: string;
    };
    pro: {
      badge: string;
      name: string;
      desc: string;
      items: string[];
      cta: string;
    };
  };
  finalCta: {
    eyebrow: string;
    heading: string;
    body: string;
    cta: string;
  };
  footer: {
    tagline: string;
    links: string[];
    fine: string;
  };
}

export const ar: Dictionary = {
  nav: {
    product: 'المنتج',
    solutions: 'الخدمات',
    why: 'لماذا الاستضافة الذاتية',
    pricing: 'الأسعار',
    signIn: 'تسجيل الدخول',
    cta: 'اطلب عرضًا توضيحيًا',
  },
  hero: {
    eyebrow: 'تحقّق ذاتي الاستضافة من الهوية والأعمال — مصمم لليبيا',
    headline: 'تحقّق من الهوية دون أن تغادر البيانات مكانها',
    sub: 'يعمل LybID داخل بنيتكم التحتية الخاصة. تُفحص جوازات السفر وبطاقات الهوية والسجلات التجارية وتُطابق وتُوثَّق، دون أن تغادر أي وثيقة أسوار البنك.',
    ctaPrimary: 'اطلب عرضًا توضيحيًا',
    ctaSecondary: 'تعرّف على ما هو متاح',
    note: 'يعمل على خوادمكم الخاصة — دون اعتماد على السحابة لقراءة الوثائق أو مطابقة الوجوه.',
    card: {
      sample: 'عيّنة — غير حقيقية',
      brand: 'LybID · هوية موثّقة',
      docLabel: 'الوثيقة',
      docValue: 'جواز سفر (MRZ)',
      liveLabel: 'الحيوية',
      liveValue: 'التقاط مباشر، ناجح',
      stateLabel: 'دولة الإصدار',
      stateValue: 'ليبيا',
      seal: 'موثّق',
    },
  },
  features: {
    eyebrow: 'ما الذي تحصل عليه',
    heading: 'منصة واحدة، لا أربعة موردين مجمّعين معًا',
    sub: 'قراءة الوثائق، والتحقق من الحيوية، ومطابقة الوجوه، والتحقق من الأعمال — كلها تعمل ضمن نفس البنية المستضافة ذاتيًا، بنفس سجل التدقيق وعزل المستأجرين.',
    items: [
      {
        title: 'يبقى داخل بنيتكم التحتية',
        body: 'كل وثيقة وصورة وقرار يبقى على خوادم تتحكمون بها أنتم — لا سحابة خارجية عليكم الوثوق بها.',
      },
      {
        title: 'مصمم للوثائق الليبية',
        body: 'نماذج السجل المدني بالعربية وجوازات السفر بنظام MRZ، تُقرأ وتُطابق بشكل أصلي — لا كإضافة لاحقة.',
      },
      {
        title: 'مباشر، لا مجرد مرفوع',
        body: 'التحقق من الحيوية عبر الكاميرا ومطابقة الوجه يثبتان وجود شخص حقيقي أمام الشاشة، لا صورة له.',
      },
      {
        title: 'KYC وKYB في منصة واحدة',
        body: 'تحقق من الشخص والشركة التي يمثلها دون الجمع بين موردين منفصلين.',
      },
    ],
  },
  solutions: {
    eyebrow: 'التغطية',
    heading: 'كل ما يتحقق منه LybID اليوم',
    sub: 'لا يوجد بعد فحص لمكافحة غسل الأموال أو مراقبة المعاملات — هذا قادم مع الباقة الاحترافية. اليوم، يغطي LybID التحقق الكامل من الهوية والأعمال.',
    filters: ['الكل', 'KYC', 'KYB', 'مكافحة غسل الأموال — قريبًا'],
    kyc: {
      label: 'التحقق من الأفراد',
      tag: 'أفراد',
      items: [
        'التحقق من جواز السفر (MRZ)',
        'بطاقة الهوية الوطنية وشهادة الميلاد',
        'كشف الحيوية',
        'مطابقة الوجه',
        'التحقق من البريد الإلكتروني والهاتف',
      ],
    },
    kyb: {
      label: 'التحقق من الأعمال',
      tag: 'شركات',
      items: ['السجل التجاري', 'عضوية الغرفة التجارية', 'التحقق من الرقم الضريبي'],
    },
    note: 'فحص مكافحة غسل الأموال ومراقبة المعاملات — قادمة مع الباقة الاحترافية',
  },
  why: {
    eyebrow: 'لماذا الاستضافة الذاتية مهمة',
    heading: 'ليست شعارًا — بل ثلاث حقائق فعلية عن البنية',
    items: [
      {
        title: 'بيانات كل مستأجر معزولة على مستوى قاعدة البيانات',
        body: 'أمان الصفوف في Postgres، لا مجرد كود التطبيق، هو ما يفرض الحدود بين البنوك التي تشارك المنصة.',
      },
      {
        title: 'لا طلبات قراءة مستندات أو بيانات حيوية تغادر شبكتكم',
        body: 'قراءة الوثائق ومطابقة الوجوه تعملان داخل حاوياتكم الخاصة — لا واجهة برمجية خارجية على المسار الحرج أبدًا.',
      },
      {
        title: 'كل عملية حذف هي حذف حقيقي',
        body: 'الحذف الذي يبدأه البنك يزيل الملفات المخزّنة والبيانات المستخرجة معًا، ويُسجَّل في سجل التدقيق.',
      },
    ],
  },
  pricing: {
    eyebrow: 'الأسعار',
    heading: 'التسعير لكل عملية تحقق، بالدينار الليبي',
    sub: 'ابدأ بالباقة الأساسية. الباقة الاحترافية مصممة للبنوك التي تحتاج مكافحة غسل الأموال ومراقبة المعاملات إلى جانب التحقق من الهوية والأعمال.',
    unit: 'د.ل / عملية تحقق',
    basic: {
      badge: 'متاحة الآن',
      name: 'أساسية',
      desc: 'تحقق كامل من الهوية للبنوك وشركات التقنية المالية المبتدئة — دون التزام بحد أدنى للبدء.',
      items: [
        'التحقق من الهوية',
        'الحيوية ومطابقة الوجه',
        'التحقق من البريد الإلكتروني/الهاتف',
        'LybID ID',
        'KYC قابل لإعادة الاستخدام',
      ],
      cta: 'اطلب عرضًا توضيحيًا',
    },
    pro: {
      badge: 'قريبًا',
      name: 'احترافية',
      desc: 'كل ما في الباقة الأساسية، بالإضافة إلى طبقة الامتثال للبنوك التي تحتاج مراقبة المخاطر باستمرار، لا فقط عند التسجيل.',
      items: ['كل ما في الباقة الأساسية', 'فحص مكافحة غسل الأموال', 'مراقبة مستمرة للمعاملات', 'مجموعة امتثال كاملة'],
      cta: 'أعلمني عند التوفر',
    },
  },
  finalCta: {
    eyebrow: 'ابدأ الآن',
    heading: 'أعِد التحقق إلى الداخل',
    body: 'تحدّثوا معنا حول تشغيل LybID داخل بنيتكم التحتية الخاصة — لا تغادر أي بيانات البنك، منذ أول وثيقة.',
    cta: 'اطلب عرضًا توضيحيًا',
  },
  footer: {
    tagline: 'تحقّق ذاتي الاستضافة من الهوية والأعمال لبنوك وشركات التقنية المالية الليبية.',
    links: ['المنتج', 'التغطية', 'الأسعار', 'تواصل معنا'],
    fine: 'LybID — بدعم من مرسى. الأسعار معروضة بالدينار الليبي، لكل عملية تحقق.',
  },
};

export const en: Dictionary = {
  nav: {
    product: 'Product',
    solutions: 'Solutions',
    why: 'Why self-hosted',
    pricing: 'Pricing',
    signIn: 'Sign in',
    cta: 'Request a demo',
  },
  hero: {
    eyebrow: 'Self-hosted KYC & KYB — built for Libya',
    headline: 'Verify identities without sending them anywhere.',
    sub: "LybID runs inside your own infrastructure. Passports, national IDs, and business registries — checked, matched, and audited without a single document leaving the bank.",
    ctaPrimary: 'Request a demo',
    ctaSecondary: "See what's included",
    note: 'Deployed on your own servers — no per-tenant cloud dependency for document reading or face matching.',
    card: {
      sample: 'SAMPLE — NOT REAL',
      brand: 'LybID · Verified Identity',
      docLabel: 'Document',
      docValue: 'Passport (MRZ)',
      liveLabel: 'Liveness',
      liveValue: 'Live capture, passed',
      stateLabel: 'Issuing state',
      stateValue: 'Libya',
      seal: 'VERIFIED',
    },
  },
  features: {
    eyebrow: "What's built in",
    heading: 'One platform, not four vendors stitched together',
    sub: 'Document reading, liveness, face matching, and business verification all run in the same self-hosted stack — same audit trail, same tenant isolation.',
    items: [
      {
        title: 'Stays on your infrastructure',
        body: 'Every document, photo, and decision lives on servers you control — not a third-party cloud you have to trust.',
      },
      {
        title: 'Built for Libyan documents',
        body: 'Arabic-script civil registry forms and MRZ passports, read and matched natively — not bolted on as an afterthought.',
      },
      {
        title: 'Live, not just uploaded',
        body: 'Camera-based liveness and face match confirm a real person in front of the screen, not a photo of one.',
      },
      {
        title: 'KYC and KYB, one platform',
        body: 'Verify a person and the business behind them without stitching two separate vendors together.',
      },
    ],
  },
  solutions: {
    eyebrow: 'Coverage',
    heading: 'Everything LybID checks today',
    sub: "No AML or transaction monitoring yet — that's arriving with Professional. Today, LybID covers full identity and business verification.",
    filters: ['All', 'KYC', 'KYB', 'AML — soon'],
    kyc: {
      label: 'KYC',
      tag: 'PEOPLE',
      items: [
        'Passport verification (MRZ)',
        'National ID & birth certificate',
        'Liveness detection',
        'Face match',
        'Email & phone verification',
      ],
    },
    kyb: {
      label: 'KYB',
      tag: 'BUSINESSES',
      items: ['Commercial registration', 'Chamber of commerce membership', 'Tax ID verification'],
    },
    note: 'AML screening & transaction monitoring — coming with Professional',
  },
  why: {
    eyebrow: 'Why self-hosted matters',
    heading: "Not a slogan — three things that are actually true of the architecture",
    items: [
      {
        title: 'Tenant data is isolated at the database level',
        body: 'Postgres row-level security, not just application code, enforces the boundary between banks sharing the platform.',
      },
      {
        title: 'No OCR or biometric calls leave your network',
        body: "Document reading and face matching both run inside your own containers — never a third-party API on the critical path.",
      },
      {
        title: 'Every erase is a real erase',
        body: "A bank-triggered deletion removes the stored files and the extracted data together, and it's audited.",
      },
    ],
  },
  pricing: {
    eyebrow: 'Pricing',
    heading: 'Priced per verification, in Libyan dinar',
    sub: 'Start on Basic. Professional is built for banks that need AML and transaction monitoring alongside identity and business verification.',
    unit: 'LYD / verification',
    basic: {
      badge: 'Available now',
      name: 'Basic',
      desc: 'Full identity verification for banks and fintechs getting started — no minimum commitment to launch with.',
      items: [
        'Identity verification',
        'Liveness & Face Match',
        'Email / phone verification',
        'LybID ID',
        'Reusable KYC',
      ],
      cta: 'Request a demo',
    },
    pro: {
      badge: 'Coming soon',
      name: 'Professional',
      desc: 'Everything in Basic, plus the compliance layer for banks that need to monitor risk continuously, not just at onboarding.',
      items: ['Everything in Basic', 'AML screening', 'Continuous transaction monitoring', 'Full compliance suite'],
      cta: 'Get notified',
    },
  },
  finalCta: {
    eyebrow: 'Get started',
    heading: 'Bring verification home.',
    body: 'Talk to us about running LybID inside your own infrastructure — no data leaves the bank, from the first document.',
    cta: 'Request a demo',
  },
  footer: {
    tagline: 'Self-hosted KYC & KYB for Libyan banks and fintechs.',
    links: ['Product', 'Coverage', 'Pricing', 'Contact'],
    fine: 'LybID — powered by Marsa. Prices shown in Libyan dinar (LYD), per verification.',
  },
};
