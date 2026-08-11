type BrailleDotsIconProps = {
  size?: number;
  color?: string;
};

export default function BrailleDotsIcon({
  size = 24,
  color = "currentColor"
}: BrailleDotsIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      {/* Top row - 3 dots */}
      <circle cx="6" cy="6" r="2" fill={color} />
      <circle cx="12" cy="6" r="2" fill={color} />
      <circle cx="18" cy="6" r="2" fill={color} />

      {/* Middle row - 3 dots */}
      <circle cx="6" cy="12" r="2" fill={color} />
      <circle cx="12" cy="12" r="2" fill={color} />
      <circle cx="18" cy="12" r="2" fill={color} />

      {/* Bottom row - 3 dots */}
      <circle cx="6" cy="18" r="2" fill={color} />
      <circle cx="12" cy="18" r="2" fill={color} />
      <circle cx="18" cy="18" r="2" fill={color} />
    </svg>
  );
}
