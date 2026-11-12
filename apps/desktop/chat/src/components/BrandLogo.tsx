import React from 'react';
import logo from 'openfilm/studio-ui/assets/zfilm-icon.png';

export function BrandLogo({ size = 18, className }: { size?: number; className?: string }) {
  return <img src={logo} width={size} height={size} className={`block shrink-0 rounded-[22%] ${className ?? ''}`.trim()} alt="Zfilm" draggable={false} />;
}
