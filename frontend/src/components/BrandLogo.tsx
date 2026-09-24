/** Shared brand mark — keep sizes modest like ChatGPT. */
export default function BrandLogo({
  className = "h-8 w-auto",
  alt = "Recall",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" alt={alt} className={`object-contain select-none ${className}`} draggable={false} />
  );
}
