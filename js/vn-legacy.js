// Chuyển chữ tiếng Việt từ các bảng mã cũ (TCVN3/ABC - phông .VnTime, VNI - phông VNI-Times) sang Unicode
// Khi PDF dùng phông cũ, chữ lấy ra thường bị lỗi kiểu "Céng hoµ x· héi" -> cần chuyển về "Cộng hoà xã hội"

const TCVN3 = {
  'µ': 'à', 'μ': 'à', '¸': 'á', '¶': 'ả', '·': 'ã', '¹': 'ạ',
  '¨': 'ă', '»': 'ằ', '¾': 'ắ', '¼': 'ẳ', '½': 'ẵ', 'Æ': 'ặ',
  '©': 'â', 'Ç': 'ầ', 'Ê': 'ấ', 'È': 'ẩ', 'É': 'ẫ', 'Ë': 'ậ',
  '®': 'đ',
  'Ì': 'è', 'Ð': 'é', 'Î': 'ẻ', 'Ï': 'ẽ', 'Ñ': 'ẹ',
  'ª': 'ê', 'Ò': 'ề', 'Õ': 'ế', 'Ó': 'ể', 'Ô': 'ễ', 'Ö': 'ệ',
  '×': 'ì', 'Ý': 'í', 'Ø': 'ỉ', 'Ü': 'ĩ', 'Þ': 'ị',
  'ß': 'ò', 'ã': 'ó', 'á': 'ỏ', 'â': 'õ', 'ä': 'ọ',
  '«': 'ô', 'å': 'ồ', 'è': 'ố', 'æ': 'ổ', 'ç': 'ỗ', 'é': 'ộ',
  '¬': 'ơ', 'ê': 'ờ', 'í': 'ớ', 'ë': 'ở', 'ì': 'ỡ', 'î': 'ợ',
  'ï': 'ù', 'ó': 'ú', 'ñ': 'ủ', 'ò': 'ũ', 'ô': 'ụ',
  '­': 'ư', 'õ': 'ừ', 'ø': 'ứ', 'ö': 'ử', '÷': 'ữ', 'ù': 'ự',
  'ú': 'ỳ', 'ý': 'ý', 'û': 'ỷ', 'ü': 'ỹ', 'þ': 'ỵ',
  '¡': 'Ă', '¢': 'Â', '§': 'Đ', '£': 'Ê', '¤': 'Ô', '¥': 'Ơ', '¦': 'Ư',
};

export function tcvn3ToUnicode(s, upper = false) {
  // Ký tự "ư" (mã 0xAD) thường bị đọc thành dấu "-" : "n-íc" -> "nước"
  s = s.replace(/-(?=[^\s\d\-–—.,;:!?)\]"'])/g, '­');
  let out = '';
  for (const ch of s) out += TCVN3[ch] ?? ch;
  out = out.normalize('NFC');
  return upper ? out.toLocaleUpperCase('vi') : out;
}

// VNI: chữ cái gốc + ký tự dấu đứng sau
const VNI_TONES = { 'ø': '̀', 'ù': '́', 'û': '̉', 'õ': '̃', 'ï': '̣' };
const VNI_HAT_TONES = { 'à': '̀', 'á': '́', 'å': '̉', 'ã': '̃', 'ä': '̣' }; // dấu cho chữ có mũ
const VNI_BREVE_TONES = { 'è': '̀', 'é': '́', 'ú': '̉', 'ü': '̃', 'ë': '̣' }; // dấu cho ă
const VNI_SINGLE = {
  'æ': 'ỉ', 'ó': 'ĩ', 'ò': 'ị', 'ô': 'ơ', 'ö': 'ư', 'î': 'ỵ', 'ñ': 'đ',
  'Æ': 'Ỉ', 'Ó': 'Ĩ', 'Ò': 'Ị', 'Ô': 'Ơ', 'Ö': 'Ư', 'Î': 'Ỵ', 'Ñ': 'Đ',
};
const lower = (c) => c.toLowerCase();

export function vniToUnicode(s) {
  const chars = [...s];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], n = chars[i + 1] ?? '', nl = lower(n), cl = lower(c);
    // ơ / ư + dấu
    if ((cl === 'ô' || cl === 'ö') && VNI_TONES[nl]) { out += (VNI_SINGLE[c]) + VNI_TONES[nl]; i++; continue; }
    if ('aeouy'.includes(cl)) {
      if (VNI_TONES[nl]) { out += c + VNI_TONES[nl]; i++; continue; }
      if (cl === 'a' && nl === 'ê') { out += c === 'A' ? 'Ă' : 'ă'; i++; continue; }
      if (cl === 'a' && VNI_BREVE_TONES[nl]) { out += (c === 'A' ? 'Ă' : 'ă') + VNI_BREVE_TONES[nl]; i++; continue; }
      if ('aeo'.includes(cl) && nl === 'â') { out += c + '̂'; i++; continue; }
      if ('aeo'.includes(cl) && VNI_HAT_TONES[nl]) { out += c + '̂' + VNI_HAT_TONES[nl]; i++; continue; }
    }
    if (cl === 'i' || c === 'ì' || c === 'í' || c === 'Ì' || c === 'Í') { out += c; continue; }
    out += VNI_SINGLE[c] ?? c;
  }
  return out.normalize('NFC');
}

/** Nhận biết phông cũ theo tên phông trong PDF */
export function legacyKind(fontName = '') {
  const n = fontName.replace(/^[A-Z]{6}\+/, '').trim();
  const base = n.split(/[,-]/)[0];
  if (/^VNI[-_ ]?[A-Z]/i.test(n)) return { kind: 'vni' };
  if (/^\.?Vn[A-Z]/.test(base)) return { kind: 'tcvn3', upper: /H$/.test(base) };
  return null;
}

export function decodeLegacy(text, info) {
  if (!info) return text;
  return info.kind === 'tcvn3' ? tcvn3ToUnicode(text, info.upper) : vniToUnicode(text);
}
