import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return <SliderPrimitive.Root
    data-slot="slider"
    className={cn('relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/20">
      <SliderPrimitive.Range className="absolute h-full bg-western-400" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-4 cursor-grab rounded-full border-2 border-western-300 bg-white shadow-md outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-western-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:cursor-grabbing disabled:pointer-events-none" />
  </SliderPrimitive.Root>;
}

export { Slider };
