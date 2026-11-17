/** 行注釈ラベルにだけ許可する最小限のescapeを復号する。 */
export function decodeCalloutLabel(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const next = value[index + 1];
    if (next === "n") {
      decoded += "\n";
      index += 1;
    } else if (next === "\\") {
      decoded += "\\";
      index += 1;
    } else {
      decoded += "\\";
    }
  }
  return decoded;
}
