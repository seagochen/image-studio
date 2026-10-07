import { useEffect, useRef, useState } from "react";
import type { ImageStudioDocument, ImageStudioLayer } from "../domain/document";
import { renderImageStudioDocument } from "../domain/exportImage";
import { ProductIcon } from "./ProductIcon";
export function LayerThumbnail({ layer, document }: {
    layer: ImageStudioLayer;
    document: ImageStudioDocument;
}): JSX.Element {
    const ref = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(false);
    const mask = document.layers.find(l => l.id === layer.rasterMaskId);
    useEffect(() => {
        if (!ref.current)
            return;
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!visible || layer.type === "group" || layer.type === "adjustment")
            return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            const layers = [{ ...layer, parentId: null, visible: true, opacity: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }, ...(mask ? [{ ...mask, parentId: null }] : [])];
            void renderImageStudioDocument({ ...document, canvas: { width: layer.width, height: layer.height }, layers }, { signal: controller.signal, scale: Math.min(1, 40 / Math.max(layer.width, layer.height)) }).then(canvas => {
                if (!controller.signal.aborted && ref.current) {
                    const target = ref.current, ctx = target.getContext("2d");
                    ctx?.clearRect(0, 0, 40, 40);
                    const ratio = Math.min(40 / canvas.width, 40 / canvas.height), width = canvas.width * ratio, height = canvas.height * ratio;
                    ctx?.drawImage(canvas, (40 - width) / 2, (40 - height) / 2, width, height);
                }
                canvas.width = canvas.height = 1;
            }).catch(() => undefined);
        }, 80);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [visible, layer, mask]);
    return <span className="layer-thumbnail" aria-hidden="true"><canvas ref={ref} width={40} height={40}/>{(layer.type === "group" || layer.type === "adjustment") && <ProductIcon name={layer.type === "group" ? "layers" : "adjust"}/>}</span>;
}
