const chineseBeforeAlphanumeric =
  /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\u{30000}-\u{3134f}])([A-Za-z0-9])/gu;
const alphanumericBeforeChinese =
  /([A-Za-z0-9])([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\u{30000}-\u{3134f}])/gu;

export function addChineseEnglishSpacing(text: string): string {
  return text.replace(chineseBeforeAlphanumeric, "$1 $2").replace(alphanumericBeforeChinese, "$1 $2");
}
