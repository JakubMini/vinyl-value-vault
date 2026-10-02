/** Discogs returns decimal amounts (12.34). We store integers in minor units (1234). */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

/** Render minor units for humans: 123456 GBP -> "£1,234.56". */
export function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}
