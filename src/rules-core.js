/* 회사 기본 규칙 (Rule Gate) — 순수 JS, 의존성 없음.
 *
 * 운영 원칙: 대표가 모든 산출물을 최종 검토하지 않는다. 대신
 *   1) 모든 에이전트가 _shared/rules.md 를 매번 읽고 규칙 안에서 일하고
 *   2) 산출물이 나오면 checkRules() 가 자동 검사해서
 *   3) 통과 → 그대로 진행 / 위반 → 텔레그램 승인 대기(/approve · /reject)
 *
 * extension.ts(esbuild 번들)와 scripts/cycle.js(24h 자율 사이클) 양쪽에서 require.
 */

const DEFAULT_RULES_MD = `# 📏 회사 기본 규칙 (Rules)

_모든 에이전트가 매번 읽고 지키는 규칙입니다. 대표는 개별 산출물을 검토하지 않고,
**규칙 위반이 감지된 건만 텔레그램으로 승인 요청**을 받습니다. 자유롭게 편집하세요._

## 1. 광고 표현 (표시·광고법)
- 객관적 근거 없는 최상급·배타적 표현 금지: "업계 1위", "국내 최초", "유일한", "최고의", "No.1"
- "100% 효과/만족/보장" 같은 절대적 표현 금지
- 근거가 있으면 출처·기준 시점을 함께 표기 (예: "OO조사 2026.08 기준")

## 2. 광고·협찬 표기 (추천·보증 심사지침)
- 광고주에게 대가(원고료·제품 제공·체험단 등)를 받은 콘텐츠는 제목 또는 첫 부분에 "광고" 또는 "협찬" 명시

## 3. 효능·성과 보장 금지
- 식품·화장품 등에 질병 치료·예방 표현 금지 ("완치", "특효", "부작용 없음")
- 광고주·고객에게 수익·매출·효과 "보장" 약속 금지

## 4. 개인정보
- 고객·광고주의 전화번호·주민등록번호 등 개인정보를 산출물에 넣지 않음

## 5. 기타 (자동 검사 X — 에이전트 자율 준수)
- 경쟁사 비방, 근거 없는 비교 광고 금지
- 출처 불명 이미지·음원·폰트 사용 금지 (라이선스 확인된 것만)
- 외부 게시·발송·결제처럼 되돌릴 수 없는 행동은 직접 하지 말고 승인 요청

## 🚫 금지어 (한 줄에 하나, "- 단어" 형식 — 자동 검사에 포함)
-
`;

/* 자동 검사 규칙. 분석 문장("최고 조회수 영상")은 걸리지 않도록 광고 문구 형태만 좁게 잡음. */
const BUILTIN_RULES = [
    { id: 'superlative', label: '근거 없는 최상급 표현', re: /(업계|국내|세계|국내외|아시아)\s*(1위|최초|최고|유일)|최고의|유일한|No\.?\s?1(?![0-9])/gi },
    { id: 'absolute', label: '100% 절대 표현', re: /100\s*%\s*(효과|만족|보장|안전|천연|환불\s*없)/gi },
    { id: 'efficacy', label: '치료·효능 표현', re: /완치|특효|기적의|부작용\s*(이\s*)?(없|제로|0)/gi },
    { id: 'guarantee', label: '수익·효과 보장 약속', re: /(수익|매출|효과|성과|원금|순위)\s*(을|를)?\s*보장/gi },
    { id: 'pii_phone', label: '전화번호 노출', re: /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g },
    { id: 'pii_rrn', label: '주민등록번호 노출', re: /\d{6}\s?-\s?[1-4]\d{6}/g },
];

const SPONSOR_CONTEXT = /체험단|원고료|제공\s*받|지원\s*받|대가를\s*받|협찬\s*받/;
const SPONSOR_LABEL = /#\s?광고|\[\s*광고\s*\]|유료\s*광고|#\s?협찬|\[\s*협찬\s*\]|광고\s*포함/;

/** rules.md 의 "금지어" 섹션에서 "- 단어" 목록을 읽음. */
function parseCustomBanned(rulesMd) {
    const m = String(rulesMd || '').match(/##[^\n]*금지어[^\n]*\n([\s\S]*?)(?=\n##\s|$)/);
    if (!m) return [];
    return m[1].split('\n')
        .map(l => l.replace(/^\s*[-*]\s*/, '').trim())
        .filter(w => w && !w.startsWith('_') && !w.startsWith('('));
}

/** 산출물 텍스트 검사. 반환: [{ id, label, hits: string[] }] — 빈 배열이면 통과. */
function checkRules(text, rulesMd) {
    const src = String(text || '');
    const out = [];
    for (const r of BUILTIN_RULES) {
        const hits = Array.from(new Set((src.match(r.re) || []).map(s => s.trim())));
        if (hits.length) out.push({ id: r.id, label: r.label, hits: hits.slice(0, 5) });
    }
    if (SPONSOR_CONTEXT.test(src) && !SPONSOR_LABEL.test(src)) {
        out.push({ id: 'sponsor_label', label: '광고·협찬 표기 누락', hits: [(src.match(SPONSOR_CONTEXT) || [''])[0]] });
    }
    const banned = parseCustomBanned(rulesMd).filter(w => src.includes(w));
    if (banned.length) out.push({ id: 'custom_banned', label: '금지어 사용', hits: banned.slice(0, 5) });
    return out;
}

function formatViolations(violations) {
    return violations.map(v => `- ${v.label}: ${v.hits.map(h => `"${h}"`).join(', ')}`).join('\n');
}

/** 에이전트 시스템 프롬프트에 붙일 규칙 블록. */
function rulesPromptBlock(rulesMd) {
    const body = String(rulesMd || '').trim() || DEFAULT_RULES_MD;
    return `\n\n[📏 회사 기본 규칙 — 반드시 준수. 위반 표현이 감지되면 산출물이 자동 보류되고 대표 승인 대기로 넘어갑니다]\n${body.slice(0, 3000)}`;
}

module.exports = { DEFAULT_RULES_MD, checkRules, formatViolations, parseCustomBanned, rulesPromptBlock };
