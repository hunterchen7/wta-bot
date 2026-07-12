import { MoonIcon, SunIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.colorScheme = next ? 'dark' : 'light';
    localStorage.setItem('wta:theme', next ? 'dark' : 'light');
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', next ? '#171717' : '#101a17');
    setDark(next);
  };
  return <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} title={`Switch to ${dark ? 'light' : 'dark'} mode`} className="rounded-xl text-slate-500 dark:text-muted-foreground">{dark ? <SunIcon /> : <MoonIcon />}</Button>;
}
