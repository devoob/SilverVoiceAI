/**
 * Trilingual support: Cantonese, Putonghua, English.
 *
 * Each app language maps to the BCP-47 tag used by the Web Speech API for
 * both recognition and synthesis. zh-HK selects Cantonese acoustic models,
 * zh-CN selects Putonghua, en-HK selects Hong Kong English.
 */

export const LANGUAGES = ["cantonese", "putonghua", "english"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_META: Record<
  Language,
  {
    /** Tag passed to SpeechRecognition.lang */
    sttTag: string;
    /** Tag used to filter SpeechSynthesis voices */
    ttsTag: string;
    /** Native label shown in the language picker */
    label: string;
    /** Secondary label in English for mixed-audience panels */
    englishLabel: string;
    /** html lang attribute */
    htmlLang: string;
  }
> = {
  cantonese: {
    sttTag: "zh-HK",
    ttsTag: "zh-HK",
    label: "粵語",
    englishLabel: "Cantonese",
    htmlLang: "zh-HK",
  },
  putonghua: {
    sttTag: "zh-CN",
    ttsTag: "zh-CN",
    label: "普通話",
    englishLabel: "Putonghua",
    htmlLang: "zh-CN",
  },
  english: {
    sttTag: "en-HK",
    ttsTag: "en-HK",
    label: "English",
    englishLabel: "English",
    htmlLang: "en-HK",
  },
};

export const DEFAULT_LANGUAGE: Language = "english";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Resolve a language from a raw BCP-47 tag (e.g. from a browser or a
 * SpeechRecognition result). Falls back to Cantonese for any zh-HK/zh-MO
 * input, and to Putonghua for other zh variants.
 */
export function languageFromTag(tag: string | undefined | null): Language {
  if (!tag) return DEFAULT_LANGUAGE;
  const t = tag.toLowerCase();
  if (t.startsWith("en")) return "english";
  if (t.startsWith("zh")) {
    if (t.includes("hk") || t.includes("mo") || t.includes("yue") || t.includes("hant")) {
      return "cantonese";
    }
    return "putonghua";
  }
  if (t.startsWith("yue")) return "cantonese";
  return DEFAULT_LANGUAGE;
}

type Strings = {
  app: {
    name: string;
    tagline: string;
  };
  nav: {
    settings: string;
    handover: string;
    handoverShort: string;
    skipToContent: string;
    reset: string;
  };
  mic: {
    idle: string;
    listening: string;
    stopListening: string;
    thinking: string;
    speaking: string;
    startCall: string;
    endCall: string;
    inCall: string;
    permissionDenied: string;
    unsupported: string;
    /** Short, natural opener. Deliberately not a list of features. */
    greeting: string;
    /** Fuller explanation, used when the user explicitly asks for help. */
    help: string;
    /** Said after a long silence. Never a hangup. */
    nudge: string;
    /** Shown while the assistant is being interrupted. */
    interrupted: string;
  };
  transcript: {
    heading: string;
    you: string;
    assistant: string;
    empty: string;
    liveRegion: string;
  };
  fallback: {
    label: string;
    placeholder: string;
    send: string;
    hint: string;
  };
  settings: {
    heading: string;
    language: string;
    textSize: string;
    speechRate: string;
    speechPitch: string;
    voice: string;
    voiceAuto: string;
    noVoices: string;
    close: string;
    engine: string;
    engineLocal: string;
    engineBrowser: string;
    engineSilent: string;
    noCantoneseVoice: string;
    textSizes: Record<"normal" | "large" | "extraLarge", string>;
    preview: string;
    previewText: string;
  };
  cards: {
    balanceTitle: string;
    availableBalance: string;
    accountEnding: string;
    savingsTip: string;
    pendingBills: string;
    noPendingBills: string;
    billDue: string;
    payNow: string;
    transferTitle: string;
    transferTo: string;
    amount: string;
    recipient: string;
    reference: string;
    receiptTitle: string;
    billPaid: string;
    transferComplete: string;
    status: string;
    transactionId: string;
    completedAt: string;
    newBalance: string;
    confirmQuestion: string;
    confirmYes: string;
    confirmNo: string;
    chooseBill: string;
    handoverTitle: string;
    handoverBody: string;
    callHotline: string;
    callFamily: string;
    backToAssistant: string;
  };
  pin: {
    title: string;
    body: string;
    digitHint: string;
    entered: string;
    clear: string;
    backspace: string;
    wrongPin: string;
    attemptsLeft: string;
    locked: string;
    cancelled: string;
    secureNote: string;
  };
  scam: {
    title: string;
    body: string;
    firstTime: string;
    highAmount: string;
    proceed: string;
    stop: string;
    advice: string;
  };
  errors: {
    unknownIntent: string;
    insufficientFunds: string;
    billNotFound: string;
    payeeNotFound: string;
    noAmount: string;
    generic: string;
  };
};

export const STRINGS: Record<Language, Strings> = {
  cantonese: {
    app: { name: "銀齡語音", tagline: "用講嘅，就搞掂銀行嘢" },
    nav: {
      settings: "設定",
      handover: "搵真人幫手",
      handoverShort: "真人",
      skipToContent: "跳去主內容",
      reset: "重置示範",
    },
    mic: {
      idle: "撳呢度開始講嘢",
      listening: "我聽緊，請講……",
      stopListening: "停止聆聽",
      thinking: "我想一想……",
      speaking: "我答緊……",
      startCall: "開始通話",
      endCall: "結束通話",
      inCall: "通話中",
      greeting: "你好！我可以幫你做啲乜嘢？",
      help: "你可以直接同我講：查結餘、交電費、水費、煤氣費，或者轉數快畀人。想搵真人幫手，隨時講「搵真人」。",
      nudge: "我仲喺度，你慢慢講，唔使急。",
      interrupted: "好，你講。",
      permissionDenied: "未能使用麥克風。請喺瀏覽器設定允許麥克風，或者用下面嘅文字輸入。",
      unsupported: "呢個瀏覽器唔支援語音辨識。請用 Chrome、Edge 或者 Safari，或者用文字輸入。",
    },
    transcript: {
      heading: "對話紀錄",
      you: "你",
      assistant: "助手",
      empty: "仲未有對話。撳下面個麥克風按鈕開始。",
      liveRegion: "助手回覆",
    },
    fallback: {
      label: "用打字代替講嘢",
      placeholder: "例如：我想交電費",
      send: "傳送",
      hint: "如果麥克風唔方便，可以直接打字。",
    },
    settings: {
      heading: "設定",
      language: "語言",
      textSize: "字體大細",
      speechRate: "講嘢速度",
      speechPitch: "聲調高低",
      voice: "聲音",
      voiceAuto: "自動揀最啱嘅聲音",
      noVoices: "搵唔到呢種語言嘅聲音。",
      engine: "聲音引擎",
      engineLocal: "本機粵語引擎",
      engineBrowser: "瀏覽器內置聲音",
      engineSilent: "無聲（只顯示文字）",
      noCantoneseVoice: "呢部裝置未安裝粵語聲音，而家會用備用聲音，聽落可能唔似粵語。想聽真正粵語，可以啟動本機粵語語音伺服器（見 remaining.md），或者喺系統設定安裝粵語語音。",
      close: "關閉設定",
      textSizes: { normal: "標準", large: "大", extraLarge: "特大" },
      preview: "試聽",
      previewText: "你好，我係銀齡語音助手。",
    },
    cards: {
      balanceTitle: "帳戶結餘",
      availableBalance: "可用結餘",
      accountEnding: "帳戶尾號",
      savingsTip: "儲錢小貼士",
      pendingBills: "未有繳交嘅賬單",
      noPendingBills: "你而家冇賬單要交，好嘢！",
      billDue: "到期日",
      payNow: "立即繳交",
      transferTitle: "轉賬",
      transferTo: "轉賬畀",
      amount: "金額",
      recipient: "收款人",
      reference: "備註",
      receiptTitle: "交易完成",
      billPaid: "賬單已繳交",
      transferComplete: "轉賬成功",
      status: "狀態",
      transactionId: "交易編號",
      completedAt: "完成時間",
      newBalance: "新結餘",
      confirmQuestion: "確不確認？",
      confirmYes: "係，確認",
      confirmNo: "唔好，取消",
      chooseBill: "你想交邊張單？",
      handoverTitle: "已為你聯絡真人",
      handoverBody: "我哋正在接駁客服專員。請稍等，唔使急。",
      callHotline: "致電客戶服務熱線",
      callFamily: "通知家人",
      backToAssistant: "返去語音助手",
    },
    pin: {
      title: "請輸入六位數保安密碼",
      body: "為咗保障你嘅存款，轉賬同繳費之前一定要輸入密碼。",
      digitHint: "已輸入密碼位數",
      entered: "已輸入",
      clear: "清除",
      backspace: "刪除一個位",
      wrongPin: "密碼唔啱，請再試過。",
      attemptsLeft: "仲有幾次機會",
      locked: "密碼試過太多次，帳戶已暫時鎖定。請致電客戶服務熱線。",
      cancelled: "已取消今次交易。你嘅錢冇郁過。",
      secureNote: "我唔會代你輸入密碼，亦唔會問你攞密碼。",
    },
    scam: {
      title: "請留意：可能係騙案",
      body: "呢筆轉賬有啲異常，請你先停一停，諗一諗。",
      firstTime: "你從來冇轉過錢畀呢個人。",
      highAmount: "呢個金額比你平時嘅轉賬大好多。",
      proceed: "我認得呢個人，繼續",
      stop: "停一停，我要諗一諗",
      advice:
        "如果有陌生人打電話或者傳訊息叫你轉數快，請即刻掛線，然後致電防騙易熱線 18222。銀行職員永遠唔會問你攞密碼。",
    },
    errors: {
      unknownIntent: "唔好意思，我听唔明。你可以講「查結餘」、「交電費」或者「轉數快」。",
      insufficientFunds: "你嘅結餘唔夠俾呢筆款項。",
      billNotFound: "搵唔到相關嘅賬單。",
      payeeNotFound: "搵唔到呢個收款人。",
      noAmount: "你想轉幾多錢？請講一個金額。",
      generic: "出了點問題，請再試一次。",
    },
  },

  putonghua: {
    app: { name: "银龄语音", tagline: "只要开口说，就能办好银行事" },
    nav: {
      settings: "设定",
      handover: "转接真人协助",
      handoverShort: "真人",
      skipToContent: "跳到主要内容",
      reset: "重置演示",
    },
    mic: {
      idle: "按这里开始说话",
      listening: "我在听，请说……",
      stopListening: "停止聆听",
      thinking: "我想一想……",
      speaking: "我正在回答……",
      startCall: "开始通话",
      endCall: "结束通话",
      inCall: "通话中",
      greeting: "你好！我可以帮你做什么？",
      help: "你可以直接跟我说：查结余、交电费、水费、煤气费，或者转数快给人。想找真人协助，随时说「找真人」。",
      nudge: "我还在，你慢慢说，不用急。",
      interrupted: "好，你说。",
      permissionDenied: "无法使用麦克风。请在浏览器设定中允许麦克风，或使用下面的文字输入。",
      unsupported: "这个浏览器不支持语音辨识。请使用 Chrome、Edge 或 Safari，或使用文字输入。",
    },
    transcript: {
      heading: "对话纪录",
      you: "你",
      assistant: "助手",
      empty: "还没有对话。请按下面的麦克风按钮开始。",
      liveRegion: "助手回复",
    },
    fallback: {
      label: "用打字代替说话",
      placeholder: "例如：我想交电费",
      send: "传送",
      hint: "如果不方便使用麦克风，可以直接打字。",
    },
    settings: {
      heading: "设定",
      language: "语言",
      textSize: "字体大小",
      speechRate: "说话速度",
      speechPitch: "声调高低",
      voice: "声音",
      voiceAuto: "自动选择最合适的声音",
      noVoices: "找不到这种语言的声音。",
      engine: "声音引擎",
      engineLocal: "本机粤语引擎",
      engineBrowser: "浏览器内置声音",
      engineSilent: "无声（只显示文字）",
      noCantoneseVoice: "这台设备未安装粤语声音，现在会用备用声音，听起来可能不像粤语。想听真正的粤语，可以启动本机粤语语音服务器（见 remaining.md），或在系统设置中安装粤语语音。",
      close: "关闭设定",
      textSizes: { normal: "标准", large: "大", extraLarge: "特大" },
      preview: "试听",
      previewText: "你好，我是银龄语音助手。",
    },
    cards: {
      balanceTitle: "账户结余",
      availableBalance: "可用结余",
      accountEnding: "账户尾号",
      savingsTip: "储蓄小贴士",
      pendingBills: "待缴账单",
      noPendingBills: "你现在没有账单要缴，很好！",
      billDue: "到期日",
      payNow: "立即缴交",
      transferTitle: "转账",
      transferTo: "转账给",
      amount: "金额",
      recipient: "收款人",
      reference: "备注",
      receiptTitle: "交易完成",
      billPaid: "账单已缴交",
      transferComplete: "转账成功",
      status: "状态",
      transactionId: "交易编号",
      completedAt: "完成时间",
      newBalance: "新结余",
      confirmQuestion: "确认吗？",
      confirmYes: "是，确认",
      confirmNo: "不，取消",
      chooseBill: "你想缴交哪一张账单？",
      handoverTitle: "已为你联络真人",
      handoverBody: "我们正在接驳客服专员。请稍候，不用急。",
      callHotline: "致电客户服务热线",
      callFamily: "通知家人",
      backToAssistant: "返回语音助手",
    },
    pin: {
      title: "请输入六位数字保安密码",
      body: "为了保障你的存款，转账和缴费之前必须输入密码。",
      digitHint: "已输入密码位数",
      entered: "已输入",
      clear: "清除",
      backspace: "删除一个位",
      wrongPin: "密码不对，请再试一次。",
      attemptsLeft: "还有几次机会",
      locked: "密码试过太多次，账户已暂时锁定。请致电客户服务热线。",
      cancelled: "已取消今次交易。你的钱没有动过。",
      secureNote: "我不会代你输入密码，也不会向你索取密码。",
    },
    scam: {
      title: "请留意：可能是骗案",
      body: "这笔转账有些异常，请先停下来想一想。",
      firstTime: "你从来没有转账给这个人。",
      highAmount: "这个金额比你平时的转账大很多。",
      proceed: "我认得这个人，继续",
      stop: "停一停，我要想一想",
      advice:
        "如果有陌生人打电话或传讯息叫你转账，请立刻挂线，然后致电防骗易热线 18222。银行职员永远不会向你索取密码。",
    },
    errors: {
      unknownIntent: "不好意思，我听不明白。你可以说「查结余」、「交电费」或「转账」。",
      insufficientFunds: "你的结余不足以支付这笔款项。",
      billNotFound: "找不到相关的账单。",
      payeeNotFound: "找不到这个收款人。",
      noAmount: "你想转多少钱？请说一个金额。",
      generic: "出了一点问题，请再试一次。",
    },
  },

  english: {
    app: { name: "SilverVoice AI", tagline: "Banking that listens, not squints" },
    nav: {
      settings: "Settings",
      handover: "Talk to a person",
      handoverShort: "Human",
      skipToContent: "Skip to main content",
      reset: "Reset the demo",
    },
    mic: {
      idle: "Tap here to start speaking",
      listening: "I'm listening, please speak…",
      stopListening: "Stop listening",
      thinking: "Let me think…",
      speaking: "Answering…",
      startCall: "Start call",
      endCall: "End call",
      inCall: "In call",
      greeting: "Hi, how can I help you today?",
      help: "Just tell me what you need: check your balance, pay your electricity, water or gas bill, or send money by FPS. Say \"talk to a person\" at any time.",
      nudge: "I'm still here — take your time.",
      interrupted: "Go ahead, I'm listening.",
      permissionDenied:
        "I can't reach the microphone. Please allow microphone access in your browser settings, or use the text box below.",
      unsupported:
        "This browser doesn't support speech recognition. Please use Chrome, Edge or Safari, or use the text box below.",
    },
    transcript: {
      heading: "Conversation",
      you: "You",
      assistant: "Assistant",
      empty: "No conversation yet. Press the microphone button below to begin.",
      liveRegion: "Assistant reply",
    },
    fallback: {
      label: "Type instead of speaking",
      placeholder: "For example: I want to pay my electricity bill",
      send: "Send",
      hint: "If the microphone isn't convenient, you can type instead.",
    },
    settings: {
      heading: "Settings",
      language: "Language",
      textSize: "Text size",
      speechRate: "Speaking speed",
      speechPitch: "Voice pitch",
      voice: "Voice",
      voiceAuto: "Automatically pick the best voice",
      noVoices: "No voices found for this language.",
      engine: "Voice engine",
      engineLocal: "Local Cantonese engine",
      engineBrowser: "Browser built-in voice",
      engineSilent: "Silent (text only)",
      noCantoneseVoice: "No Cantonese voice is installed on this device, so a fallback voice is being used and may not sound like Cantonese. Start the local Cantonese speech server (see remaining.md), or install a Cantonese voice in your system settings.",
      close: "Close settings",
      textSizes: { normal: "Standard", large: "Large", extraLarge: "Extra large" },
      preview: "Preview",
      previewText: "Hello, I'm your SilverVoice assistant.",
    },
    cards: {
      balanceTitle: "Account balance",
      availableBalance: "Available balance",
      accountEnding: "Account ending",
      savingsTip: "Savings tip",
      pendingBills: "Bills waiting to be paid",
      noPendingBills: "You have no bills to pay right now. Well done!",
      billDue: "Due",
      payNow: "Pay now",
      transferTitle: "Transfer",
      transferTo: "Transfer to",
      amount: "Amount",
      recipient: "Recipient",
      reference: "Reference",
      receiptTitle: "Transaction complete",
      billPaid: "Bill paid",
      transferComplete: "Transfer complete",
      status: "Status",
      transactionId: "Reference",
      completedAt: "Completed",
      newBalance: "New balance",
      confirmQuestion: "Shall I go ahead?",
      confirmYes: "Yes, confirm",
      confirmNo: "No, cancel",
      chooseBill: "Which bill would you like to pay?",
      handoverTitle: "Connecting you to a person",
      handoverBody: "We're connecting you to a service officer. Please wait — there's no rush.",
      callHotline: "Call the customer service hotline",
      callFamily: "Notify a family member",
      backToAssistant: "Back to the assistant",
    },
    pin: {
      title: "Enter your 6-digit security PIN",
      body: "To protect your money, a PIN is required before any transfer or bill payment.",
      digitHint: "PIN digits entered",
      entered: "Entered",
      clear: "Clear",
      backspace: "Delete last digit",
      wrongPin: "That PIN isn't right. Please try again.",
      attemptsLeft: "attempts left",
      locked: "Too many incorrect attempts. The account is temporarily locked. Please call customer service.",
      cancelled: "Transaction cancelled. Your money has not moved.",
      secureNote: "I will never enter your PIN for you, and I will never ask you to read it out.",
    },
    scam: {
      title: "Please be careful: this could be a scam",
      body: "Something about this transfer looks unusual. Let's pause for a moment.",
      firstTime: "You have never sent money to this person before.",
      highAmount: "This amount is much larger than your usual transfers.",
      proceed: "I know this person, continue",
      stop: "Stop — I need to think",
      advice:
        "If a stranger has called or messaged you asking for a transfer, hang up and call the Anti-Deception Hotline on 18222. Bank staff will never ask for your PIN.",
    },
    errors: {
      unknownIntent:
        "Sorry, I didn't catch that. You can say \"check my balance\", \"pay my electricity bill\" or \"transfer money\".",
      insufficientFunds: "Your balance isn't enough for this payment.",
      billNotFound: "I couldn't find that bill.",
      payeeNotFound: "I couldn't find that recipient.",
      noAmount: "How much would you like to transfer? Please tell me an amount.",
      generic: "Something went wrong. Please try again.",
    },
  },
};

export type StringTable = Strings;

export function strings(lang: Language): Strings {
  return STRINGS[lang] ?? STRINGS[DEFAULT_LANGUAGE];
}
