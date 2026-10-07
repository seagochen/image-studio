import type { LayerEffects } from "./document";
import { releaseRenderCanvas } from "./renderMemory";
/** Draw live effects from the already-masked alpha silhouette, before source pixels. */
export function drawLayerEffects(context: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, effects: LayerEffects, createCanvas: (width: number, height: number) => HTMLCanvasElement, scale: number): void {
    let tinted: HTMLCanvasElement | undefined, outline: HTMLCanvasElement | undefined;
    try {
        tinted = createCanvas(width, height);
        const tint = tinted.getContext("2d");
        if (!tint)
            throw new Error("Layer effect canvas is unavailable");
        tint.scale(scale, scale);
        const colorize = (color: string) => { tint.clearRect(0, 0, width, height); tint.globalCompositeOperation = "source-over"; tint.drawImage(image, 0, 0, width, height); tint.globalCompositeOperation = "source-in"; tint.fillStyle = color; tint.fillRect(0, 0, width, height); };
        if (effects.shadow && effects.shadow.opacity > 0) {
            const e = effects.shadow;
            colorize(e.color);
            context.save();
            context.globalAlpha *= e.opacity;
            context.filter = `blur(${e.blur * scale}px)`;
            context.drawImage(tinted, e.offsetX, e.offsetY, width, height);
            context.restore();
        }
        if (effects.stroke && effects.stroke.width > 0 && effects.stroke.opacity > 0) {
            const e = effects.stroke, pad = Math.ceil(e.width);
            outline = createCanvas(width + pad * 2, height + pad * 2);
            const out = outline.getContext("2d");
            if (!out)
                throw new Error("Layer effect canvas is unavailable");
            out.scale(scale, scale);
            // Union the offsets at full opacity, then apply effect opacity exactly once.
            for (let radius = 1; radius <= pad; radius++)
                for (let i = 0; i < 32; i++) {
                    const angle = i * Math.PI / 16, d = Math.min(radius, e.width);
                    out.drawImage(image, pad + Math.cos(angle) * d, pad + Math.sin(angle) * d, width, height);
                }
            out.globalCompositeOperation = "source-in";
            out.fillStyle = e.color;
            out.fillRect(0, 0, width + pad * 2, height + pad * 2);
            out.globalCompositeOperation = "destination-out";
            out.drawImage(image, pad, pad, width, height);
            context.save();
            context.globalAlpha *= e.opacity;
            context.drawImage(outline, -pad, -pad, width + pad * 2, height + pad * 2);
            context.restore();
        }
    }
    finally {
        if (tinted)
            releaseRenderCanvas(tinted);
        if (outline)
            releaseRenderCanvas(outline);
    }
}
