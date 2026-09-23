import type { ProductIconName } from "../generated/productIconNames";
export { PRODUCT_ICON_NAMES } from "../generated/productIconNames";
export type { ProductIconName } from "../generated/productIconNames";

interface Props {
  name: ProductIconName;
  className?: string;
}

export function ProductIcon({ name, className = "" }: Props): JSX.Element {
  return <svg className={`product-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <use className="product-icon-depth" href={`/icons.svg#icon-${name}`} />
    <use className="product-icon-main" href={`/icons.svg#icon-${name}`} />
  </svg>;
}
