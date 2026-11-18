import { useState } from "react";
import { Badge, Button, CheckIcon, CopyIcon, QrCodeIcon } from "@edusearch/ui";
import type { Checkout } from "../lib/api/types";

/**
 * Área do QR Code Pix. Só exibe uma imagem quando a cobrança vier de uma
 * integração autorizada. Na demonstração: placeholder NÃO pagável, sem
 * nenhum padrão que se pareça com um QR Code válido.
 */
export function PixQrCode({ checkout }: { checkout: Checkout }) {
  const src = checkout.simulated ? null : checkout.pix.qrCodeImageUrl;
  if (src) {
    return <img src={src} alt="QR Code Pix para pagamento da aula" width={208} height={208} className="mx-auto h-52 w-52 rounded-control bg-white p-2" />;
  }
  return (
    <div
      role="img"
      aria-label="QR Code simulado, não pagável"
      className="mx-auto flex h-52 w-52 flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-line-strong bg-surface-muted p-4 text-center"
    >
      <QrCodeIcon className="h-12 w-12 text-fg-muted" />
      <span className="text-sm font-semibold text-fg-strong">QR Code simulado</span>
      <span className="text-xs text-fg-muted">Não pagável. O QR Code real virá do gateway.</span>
    </div>
  );
}

/** Pix Copia e Cola. O botão de copiar só funciona com um código real e autorizado. */
export function PixCopyPaste({ checkout }: { checkout: Checkout }) {
  const [copied, setCopied] = useState(false);
  const code = checkout.simulated ? null : checkout.pix.copyPasteCode;
  const expired = checkout.status === "expired";

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`pix-${checkout.id}`} className="text-sm font-medium text-fg-strong">
          Pix Copia e Cola
        </label>
        {!code && <Badge tone="demo">{expired ? "Expirado" : "Sem código disponível"}</Badge>}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input
          id={`pix-${checkout.id}`}
          readOnly
          value={code ?? ""}
          placeholder={expired ? "Cobrança expirada" : "Disponível somente com integração autorizada"}
          aria-describedby={`pix-hint-${checkout.id}`}
          className="h-11 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-muted px-3.5 font-mono text-sm text-fg-strong placeholder:font-sans placeholder:text-fg-muted"
        />
        <Button variant="secondary" leftIcon={copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />} disabled={!code || expired} onClick={copy}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p id={`pix-hint-${checkout.id}`} className="mt-1.5 text-xs text-fg-muted" aria-live="polite">
        {copied
          ? "Código copiado. Cole no app do seu banco."
          : code
            ? "Copie o código e pague no app do seu banco."
            : "Na demonstração nenhum código Pix é gerado: nada pode ser pago."}
      </p>
    </div>
  );
}
