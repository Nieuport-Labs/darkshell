import { encodePaymentLink, encodePaymentUri, type PaymentRequest } from 'secret-pay';
import { PAY_LINK_ORIGIN } from '../config';

/** What "Share" hands out: the https pay link when a public origin is configured, else the `secret:` URI. */
export function shareTarget(req: PaymentRequest): string {
	return PAY_LINK_ORIGIN ? encodePaymentLink(PAY_LINK_ORIGIN, req) : encodePaymentUri(req);
}
