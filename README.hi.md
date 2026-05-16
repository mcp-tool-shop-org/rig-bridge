<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**स्थिति:** v1.0.x npm पर उपलब्ध है। **8 में से 8 CLI कमांड** (init / new / send / close / status / thread / sync / relay)। क्रॉस-रिग ड्रिफ्ट का पता क्रॉस-रिग एंड-टू-एंड परीक्षण (CRLF/LF ट्रांसपोर्ट, 3-रिग टोपोलॉजी) के माध्यम से सिद्ध हुआ है। v1.1 में कंट्रोल-प्लान एकीकरण शामिल है।

जोड़े गए डेवलपमेंट रिग के लिए क्रॉस-रिग सिंक टूल - गिट-नेटिव टाइप-एनवेलप क्रॉस-एजेंट हैंडऑफ।

## आज यहां क्या है

**v1.0.x ट्रांसपोर्ट सरफेस (पूर्ण):**

सभी 8 CLI कमांड और उनके पीछे के इंजन हेल्पर। v1.0.x गिट ट्रांसपोर्ट को अलग से प्रदान करता है - कंट्रोल-प्लान एकीकरण को v1.1 (पाथ बी-2; देखें [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)) में स्थगित कर दिया गया है।

कमांड बनाने:

- `rig-bridge init` — स्थानीय क्लोन को इनिशियलाइज़ करें, कमिट-मैसेज हुक स्थापित करें, और इस रिग की कैनोनिकल आईडी के साथ `.bridge/config.yaml` लिखें।
- `rig-bridge new <thread-id>` — एनवेलप टेम्पलेट से `<thread-id>/REQUEST.md` बनाएं, फ्रंटमैटर पहले से भरा हुआ।
- `rig-bridge send <type> --thread <id>` — एक टाइप एनवेलप लिखें, स्कीमा के विरुद्ध मान्य करें, `body_hash` की गणना करें, मार्कर से `status_class` प्राप्त करें, फिर `git commit && git push` करें।
- `rig-bridge close <thread-id> --status <cancelled|completed>` — `RESOLUTION.md` लिखें, कमिट करें, पुश करें।

निरीक्षण कमांड:

- `rig-bridge status` — अंतिम गतिविधि, स्टेटस क्लास, प्रकार और गंदे स्थिति के साथ खुले थ्रेड की सूची बनाएं; `--json` + `--wide` विकल्प उपलब्ध हैं।
- `rig-bridge thread <id>` — एक थ्रेड के लिए पूर्ण एनवेलप ट्रांसक्रिप्ट प्रदर्शित करें (छोटे-मल्टीपल लेआउट, कालानुक्रमिक क्रम में, TTY पर ऑटो-पेज)।

सिंक + एटेस्टेशन कमांड:

- `rig-bridge sync` — विचलन को उजागर करते हुए फास्ट-फॉरवर्ड पुल (गैर-FF को `--auto` के बिना अस्वीकार करता है; फॉसिल-शैली अर्थों के अनुसार सिंक सीमा पर नामित विचलन को उजागर करता है)।
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` — मानव-प्रमाणित निर्णय/प्रतिक्रिया/स्वीकृति टर्न (एक `-relay` रिग-आई प्रत्यय + गिट साइनिंग कुंजी की आवश्यकता होती है; `attested_by` + `attested_at` + ULID `nonce` के साथ एक एटेस्टेशन ब्लॉक उत्सर्जित करता है)।

इंजन हेल्पर ( `src/engine/` में, `src/engine/index.ts` से पुन: निर्यात किया गया, v1.1 कंट्रोल-प्लान उपभोक्ता सरफेस के रूप में):

- `envelope.ts` — YAML फ्रंटमैटर पार्स/रेंडर।
- `schema-validator.ts` — `schemas/bridge-message.schema.json` के विरुद्ध Ajv-समर्थित सत्यापन।
- `body-hash.ts` — §4.1-मानकीकृत बॉडी पर SHA-256 (CRLF→LF, ट्रेलिंग व्हाइटस्पेस हटाएं, बिल्कुल एक टर्मिनल नई लाइन, BOM हटाएं)।
- `status.ts` — मार्कर → `status_class` व्युत्पत्ति §4.2 के अनुसार (`▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled`)।
- `rig-id.ts` — कैनोनिकल केबाब-केस रिग आईडी सत्यापन + `normalizeRigId` इनग्रेस हेल्पर।
- `git.ts` — सबमॉड्यूल, आकार और OS-जंक गार्ड के साथ गिट रैपर (50 MB `maxBuffer` `spawnSync` पर)।
- `config.ts` — `.bridge/config.yaml` रीडर/राइटर (विंडोज ऑटोसीआरएलएफ सुरक्षा के लिए YAML पार्स करने से पहले लाइन-एंडिंग को सामान्य करें)।
- `threads.ts` — `listThreads` — कार्य ट्री से खुले थ्रेड को सूचीबद्ध करें ( `status` के लिए)।
- `peer-rigs.ts` — `findPeerRigs` — एनवेलप इतिहास से कैनोनिकल पीयर रिग-आईडी का पता लगाएं (इनलाइन `inferPeerRig` को बदलता है)।
- `git-diff.ts` — `gitDiffSinceLastSync` — अंतिम सफल पुल के बाद नई फ़ाइलों को प्रदर्शित करें (सिंक इंजन; फास्ट-फॉरवर्ड पात्रता ध्वज)।
- `verify-hash.ts` — `verifyHash` — `in_reply_to` श्रृंखला की अखंडता के लिए `body_hash` की पुनर्गणना करें और उसकी तुलना करें (रिले इंजन)।
- `validate-file.ts` — `validateEnvelopeFile` — एक कॉल में पार्स करें + स्कीमा-मान्य करें + हैश सत्यापित करें ( `thread`, `sync`, `relay` द्वारा साझा)।
- `index.ts` — स्थिर सार्वजनिक-एपीआई बैरल; v1.1 कंट्रोल-प्लान लेखक + डाउनस्ट्रीम उपभोक्ता यहां से आयात करते हैं।

**फेज 0 डिलीवरी (अभी भी आधिकारिक):**

`- `docs/envelope-spec.md` — यह फ़ाइल 'एन्वेलप' के स्पेसिफिकेशन को परिभाषित करती है, जिसे 'rig-bridge' द्वारा प्रबंधित किया जाता है (यह 'ट्रांसपोर्ट' से स्वतंत्र है और इसमें 'फ्रंटमैटर' और 'बॉडी कॉन्ट्रैक्ट' शामिल हैं)।
- `schemas/bridge-message.schema.json` — यह फ़ाइल 'एन्वेलप' के 'फ्रंटमैटर' के लिए JSON स्कीमा 2020-12 को परिभाषित करती है (यह 'वैलिडेशन' का स्रोत है)।
- `docs/control-plane-integration.md` — यह 'स्वारम-कंट्रोल-प्लेन' के SQLite डेटाबेस के साथ 'राइट-थ्रू' डिज़ाइन का वर्णन करता है (यह एक 'फॉरवर्ड-डिज़ाइन' है; v1.1 का हिस्सा)।
- `docs/v1.1-roadmap.md` — यह बताता है कि v1.1 में क्या शामिल होगा: 'कंट्रोल-प्लेन' राइट्स, 'फेज 7' अध्ययन द्वारा उजागर किए गए प्रश्न, और 'पार्क्ड रिव्यू-सरफेस' प्रश्न।
- `docs/cli-contract.md` — यह 'स्थिर CLI' (कमांड लाइन इंटरफेस) के नियमों को परिभाषित करता है (जैसे कि 'stdout/stderr', '--json' स्कीमा, 'एग्जिट कोड', और 'एनवायरनमेंट वेरिएबल')।
- `ARCHITECTURE.md` — यह 'D2a-with-control-plane-bridge-glue' निर्णय और 'स्कीमा क्रॉस-रेफरेंस' के बारे में जानकारी देता है।

## इंस्टॉलेशन

### npm से

```bash
npm install -g @mcptoolshop/rig-bridge
```

### स्रोत कोड से

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### सत्यापन

```bash
rig-bridge --version
```

यह `package.json` फ़ाइल में दर्ज संस्करण को प्रदर्शित करना चाहिए।

### समर्थित रनटाइम

- **Node:** `>= 20.11.0` (जैसा कि `package.json` में `engines.node` में बताया गया है)
- **npm:** `>= 10.0.0` (Node `>= 20.11.0` के साथ बंडल किया गया)

### समर्थित प्लेटफॉर्म

macOS, Linux, और Windows 10+ — ये सभी प्लेटफॉर्म CI (निरंतर एकीकरण) द्वारा हर बदलाव के साथ जांचे जाते हैं।

## यह क्या है

यह एक CLI (कमांड लाइन इंटरफेस) और इंजन लाइब्रेरी है जो दो (या अधिक) 'क्लाउड' इंस्टेंस को अलग-अलग 'रिग' पर एक साझा 'गिट' रिपॉजिटरी के माध्यम से समन्वय स्थापित करने की अनुमति देता है, जो एक 'टाइप्ड-एन्वेलप' प्रोटोकॉल का उपयोग करता है। यह प्रोटोकॉल 2026-04-29 को एक मैक और एक विंडोज GPU 'रिग' के बीच 16 कमिट के एक 'ऑर्गेनिक सेशन' में सफलतापूर्वक काम किया था।

v1.0.x में सभी 8 कमांड उपलब्ध हैं। v1.1 में 'कंट्रोल-प्लेन' एकीकरण जोड़ा जाएगा ताकि 'एन्वेलप' 'स्वारम-कंट्रोल-प्लेन' के SQLite डेटाबेस में लिखा जा सके, जो 'डिफ़ॉल्ट सत्य' का स्तर होगा — अधिक जानकारी के लिए [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md) देखें।

यह प्रोटोकॉल अपने स्वयं के 'एन्वेलप' का उपयोग करता है (यह 'ट्रांसपोर्ट' से स्वतंत्र है)। 'गिट' 'रिग' के बीच कनेक्शन स्थापित करता है; v1.1 में 'कंट्रोल-प्लेन' 'स्थायी स्थिति' बन जाता है।

## CLI अनुबंध

'rig-bridge' [clig.dev](https://clig.dev/) के सिद्धांतों का पालन करता है: 'stdout' डेटा है, 'stderr' विवरण है, और '--json' एक 'स्थिरता अनुबंध' है। पूर्ण विनिर्देश के लिए [`docs/cli-contract.md`](docs/cli-contract.md) देखें — 'आउटपुट अनुशासन', '--json' स्कीमा (`schema_version: "1.0"`), प्रत्येक कमांड के लिए 'stdout' का प्रारूप, 'एग्जिट कोड', और 'एनवायरनमेंट वेरिएबल'।

### उदाहरण उपयोग

```bash
# Initialize the local clone on the GPU rig
rig-bridge init

# Open a new thread and send a typed REQUEST envelope
rig-bridge new bridge-onboarding-01
rig-bridge send REQUEST --thread bridge-onboarding-01

# Glance at what's open across all threads
rig-bridge status

# Pull from the peer rig (fast-forward only by default)
rig-bridge sync
```

'स्क्रिप्टेड' उपयोगकर्ताओं के लिए, प्रत्येक कमांड '--json' विकल्प स्वीकार करता है:

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## सुरक्षा और डेटा

- **डेटा:** 'ब्रिज' रिपॉजिटरी की स्थानीय प्रतिलिपि + `.bridge/config.yaml` (रिग पहचानकर्ता + वैकल्पिक 'डिस्प्ले नेम') + 'मैसेज' फ़ाइलें (YAML 'फ्रंटमैटर' के साथ 'मार्कडाउन')। कोई डेटाबेस नहीं। कोई 'टेलीमेट्री' एंडपॉइंट नहीं।
- **नेटवर्क:** केवल कॉन्फ़िगर किए गए 'गिट' रिमोट (डिफ़ॉल्ट रूप से HTTPS के माध्यम से GitHub) पर। कोई अन्य नेटवर्क एक्सेस नहीं।
- **आवश्यक अनुमतियाँ:** स्थानीय 'ब्रिज' रिपॉजिटरी और `.bridge/` निर्देशिका तक पढ़ने/लिखने की पहुंच; 'पुश' के लिए 'गिट' क्रेडेंशियल (ऑपरेटर के मौजूदा 'गिट' कॉन्फ़िगरेशन पर निर्भर)।
- **डिफ़ॉल्ट रूप से कोई 'टेलीमेट्री' नहीं:** 'rig-bridge' किसी भी उपयोग डेटा को एकत्र, प्रसारित या संग्रहीत नहीं करता है। केवल वे डेटा जो ऑपरेटर द्वारा स्पष्ट रूप से 'पुश' किए जाते हैं, वे ही स्थानीय मशीन से बाहर जाते हैं।
- **विश्वास मॉडल:** 'rig-bridge', 'ट्रांसपोर्ट' की अखंडता के लिए GitHub TLS पर और 'लेखकत्व' के लिए स्थानीय 'गिट' कॉन्फ़िगरेशन पर भरोसा करता है। 'init', 'new', 'send', 'close', 'status', 'thread', और 'sync' कमांड स्वयं कमिट पर हस्ताक्षर नहीं करते हैं; ऑपरेटर मौजूदा 'गिट' तंत्रों के माध्यम से GPG/SSH 'कमिट' हस्ताक्षर लागू कर सकते हैं। 'relay' कमांड एक अपवाद है — इसके लिए एक कॉन्फ़िगर किए गए 'गिट' हस्ताक्षर कुंजी की आवश्यकता होती है (डिजाइन द्वारा बिना हस्ताक्षर के अस्वीकार कर दिया जाता है, 'मानव-प्रमाणित गेटवे' मॉडल के अनुसार) और हस्ताक्षरकर्ता की पहचान को 'एन्वेलप' के `attested_by` फ़ील्ड में रिकॉर्ड करता है।

कमजोरियों की रिपोर्टिंग और समर्थित संस्करणों के लिए [SECURITY.md](SECURITY.md) देखें।

## लाइसेंस

MIT — [LICENSE](LICENSE) देखें।

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
