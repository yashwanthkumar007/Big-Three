type BarcodeIconProps = {
  size?: number;
  color?: string;
};

export default function BarcodeIcon({
  size = 22,
  color = "currentColor"
}: BarcodeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      <rect x="5" y="4" width="2" height="16" rx="0.5" fill={color} />
      <rect x="9" y="4" width="1" height="16" rx="0.5" fill={color} />
      <rect x="13" y="4" width="3" height="16" rx="0.5" fill={color} />
      <rect x="18" y="4" width="1" height="16" rx="0.5" fill={color} />
    </svg>
  );
}