import * as React from 'react'
import { cn } from '@/lib/utils'

/** shadcn Native Select: native keyboard/mobile picker and standard form events. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => <select ref={ref} data-slot="native-select" className={cn('ui-select', className)} {...props}>{children}</select>,
)
NativeSelect.displayName = 'NativeSelect'

export function NativeSelectOption(props: React.ComponentProps<'option'>) { return <option data-slot="native-select-option" {...props} /> }
export function NativeSelectOptGroup(props: React.ComponentProps<'optgroup'>) { return <optgroup data-slot="native-select-optgroup" {...props} /> }
