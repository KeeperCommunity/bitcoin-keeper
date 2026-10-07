import React, { ReactNode, useRef, useState } from 'react';
import QRScanner from 'src/components/QRScanner';

// Keep the scanner available until the request has actually been prepared and sent.
export default function ChannelRequestScanner({
  onScanCompleted,
  children,
}: {
  onScanCompleted: (data: string) => boolean | Promise<boolean>;
  children: ReactNode;
}) {
  const [requestSent, setRequestSent] = useState(false);
  const preparing = useRef(false);
  const sent = useRef(false);
  const onScan = async (data: string) => {
    if (preparing.current || sent.current) return;
    preparing.current = true;
    try {
      if (await onScanCompleted(data)) {
        sent.current = true;
        setRequestSent(true);
      }
    } finally {
      preparing.current = false;
    }
  };
  return requestSent ? <>{children}</> : <QRScanner onScanCompleted={onScan} />;
}
