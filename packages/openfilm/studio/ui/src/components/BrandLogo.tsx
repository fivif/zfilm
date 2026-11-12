import logo from '../assets/zfilm-icon.png';

export function BrandLogo({ size = 18 }: { size?: number }) {
  return <img src={logo} width={size} height={size} className="block shrink-0 rounded-[22%]" alt="Zfilm" draggable={false} />;
}
