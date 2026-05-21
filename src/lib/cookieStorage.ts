const DOMAIN = '.primitive-os.cc';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const cookieStorage = {
  getItem(key: string): string | null {
    const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(key)}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  },
  setItem(key: string, value: string): void {
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; domain=${DOMAIN}; path=/; max-age=${MAX_AGE}; secure; samesite=lax`;
  },
  removeItem(key: string): void {
    document.cookie = `${encodeURIComponent(key)}=; domain=${DOMAIN}; path=/; max-age=0`;
  },
};
