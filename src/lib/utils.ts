import { clsx, type ClassValue } from 'clsx'

// shadcn composition with the existing CSS tokens (this app does not use Tailwind).
export function cn(...inputs: ClassValue[]) { return clsx(inputs) }
