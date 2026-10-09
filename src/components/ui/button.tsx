import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Adapted from shadcn/ui Button; styling lives in ui-components.css using Ripple tokens.
export const buttonVariants = cva('ui-button', {
  variants: {
    variant: { default: 'ui-button-primary', outline: 'ui-button-outline', secondary: 'ui-button-secondary',
      destructive: 'ui-button-destructive', ghost: 'ui-button-ghost', link: 'ui-button-link' },
    size: { default: 'ui-button-default', sm: 'ui-button-sm', lg: 'ui-button-lg', icon: 'ui-button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} data-slot="button" data-variant={variant ?? 'default'} data-size={size ?? 'default'}
      className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading}
      type={asChild ? undefined : type ?? 'button'} aria-busy={loading || undefined} {...props}>
      {asChild ? children : <>{loading && <span className="spinner" aria-hidden="true" />}{children}</>}
    </Comp>
  },
)
Button.displayName = 'Button'
