interface BrandMarkProps {
  className?: string
}

const brandMarkUrl = `${import.meta.env.BASE_URL}favicon.svg`

export function BrandMark({ className }: BrandMarkProps) {
  return <img className={className} src={brandMarkUrl} alt="" aria-hidden="true" draggable={false}/>
}
