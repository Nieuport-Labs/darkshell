// SNIP-20 tokens DarkShell can be asked to pay in. Generated from
// Nieuport-Labs/Secret_Dashboard `src/tokens/registry.ts` (itself adapted from
// dash.scrt.network, MIT) and its IBC route table (`bankDenomFor`).
// `bankDenom` is the public denomination a token redeems into, when there is
// exactly one. Code hashes are never stored; they are read from the chain.

import { findAsset, registerAsset } from 'secret-pay';
import { SSCRT_ADDRESS } from './config';

export interface TokenInfo {
	symbol: string;
	name: string;
	address: string;
	decimals: number;
	bankDenom?: string;
	/** bridged via Axelar; routes disabled since 2026-06-10 */
	axelar?: boolean;
	coingeckoId?: string;
}

export const TOKENS: TokenInfo[] = [
	{ symbol: "SCRT", name: "Secret", address: "secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek", decimals: 6, bankDenom: "uscrt", coingeckoId: "secret" },
	{ symbol: "AKT", name: "Akash Governance Token", address: "secret168j5f78magfce5r2j4etaytyuy7ftjkh4cndqw", decimals: 6, bankDenom: "ibc/448B29AB9766D29CC09944EDF6A08573B45A37C55746A45FA3CF53F1B58DF98D", coingeckoId: "akash-network" },
	{ symbol: "ATOM", name: "Cosmos Hub Governance Token", address: "secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe", decimals: 6, bankDenom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", coingeckoId: "cosmos" },
	{ symbol: "BLD", name: "Agoric Governance Token", address: "secret1uxvpq889uxjcpj656yjjexsqa3zqm6ntkyjsjq", decimals: 6, bankDenom: "ibc/CDEA201B61DF09C2456A91A60A87856796E6B40FAF41FC64E3482D4EF07DE26C", coingeckoId: "agoric" },
	{ symbol: "dATOM", name: "Drop ATOM", address: "secret1x3cxgrwymk7yyelf2782r8ay020xyl96zq3rhh", decimals: 6, bankDenom: "ibc/E6B206CCAA9570BED0716B7FD4A6F9C6786249EABC24AFFD2B1A47A752C32159", coingeckoId: "cosmos" },
	{ symbol: "DOT", name: "Polkadot Governance Token", address: "secret1h5d3555tz37crrgl5rppu2np2fhaugq3q8yvv9", decimals: 10, bankDenom: "ibc/78F0983CCA5E2A9E4950CBF4BECDAD16289D70B5A093BEE272A1FD05EC2E8E82", coingeckoId: "polkadot" },
	{ symbol: "DVPN", name: "Sentinel Governance Token", address: "secret15qtw24mpmwkjessr46dnqruq4s4tstzf74jtkf", decimals: 6, bankDenom: "ibc/E83107E876FF194B54E9AC3099E49DBB7728156F250ABD3E997D2B7E89E0810B", coingeckoId: "sentinel" },
	{ symbol: "dYdX", name: "dYdX governance token", address: "secret13lndcagy53wfzh69rtv0dex3a7cks0dv5emwke", decimals: 18, bankDenom: "ibc/007F5EB5C29FF8BB23133B099B4A3D68326BD02B05E20590287746FAFF29E3CD", coingeckoId: "dydx" },
	{ symbol: "DYM", name: "Dymension governance token", address: "secret1vfe63g7ndhqq9qu8v4n97fj69rcmr5fy0dun75", decimals: 18, bankDenom: "ibc/6F3AC063885E799319E49C0F5D984C5DB1FC6542558225B87653023342DDD2CE", coingeckoId: "dymension" },
	{ symbol: "ECLIP", name: "Eclipse.fi governance token", address: "secret1r4cldegd4peufgtaxf0qpagclqspeqaf8dm0l9", decimals: 6, bankDenom: "ibc/29E66548B3FE6F694001EE8902B40DD24D9FF2D538AAA8BB4C05E52C713B9C75", coingeckoId: "eclipse-fi" },
	{ symbol: "GRAV", name: "Gravity Bridge Governance Token", address: "secret1dtghxvrx35nznt8es3fwxrv4qh56tvxv22z79d", decimals: 6, bankDenom: "ibc/DEEF987757F80419CC651C8323ACD21D6C3D664E51B5E5A29B2663F5AD132A67", coingeckoId: "graviton" },
	{ symbol: "HUAHUA", name: "Chihuahua Governance Token", address: "secret1ntvxnf5hzhzv8g87wn76ch6yswdujqlgmjh32w", decimals: 6, bankDenom: "ibc/630E7B10690ADEC9E9CEEE904CE78C522BBCDDC6A081B23FA26A55F6EF40E41E", coingeckoId: "chihuahua-token" },
	{ symbol: "INJ", name: "Injective Governance Token", address: "secret14706vxakdzkz9a36872cs62vpl5qd84kpwvpew", decimals: 18, bankDenom: "ibc/5A76568E079A31FA12165E4559BA9F1E9D4C97F9C2060B538C84DCD503815E30", coingeckoId: "injective-protocol" },
	{ symbol: "IST", name: "Inter Protocol USD Stablecoin", address: "secret1xmqsk8tnge0atzy4e079h0l2wrgz6splcq0a24", decimals: 6, bankDenom: "ibc/5BE3E5E08E949BDF29EE93E81BF2CBD66347C86CE3D5D99A6E6FB487E62D8414", coingeckoId: "inter-stable-token" },
	{ symbol: "JKL", name: "Jackal Governance Token", address: "secret1sgaz455pmtgld6dequqayrdseq8vy2fc48n8y3", decimals: 6, bankDenom: "ibc/B6E97E0FB88FF4660A677B27CE0CD03E5F74E0DE1B9D2B65F107249A3CE5C8FB", coingeckoId: "jackal-protocol" },
	{ symbol: "JUNO", name: "Juno Governance Token", address: "secret1z6e4skg5g9w65u5sqznrmagu05xq8u6zjcdg4a", decimals: 6, bankDenom: "ibc/DF8D00B4B31B55AFCA9BAF192BC36C67AA06D9987DCB96490661BCAB63C27006", coingeckoId: "juno-network" },
	{ symbol: "KAVA", name: "Kava Governance Token", address: "secret1xyhphws090fqs33sxkytmagwynz54eqnpdqfrw", decimals: 6, bankDenom: "ibc/6301A6E3731936DB3924F580AB96CEB72F97B21EFED083779984BE7322B7815A", coingeckoId: "kava" },
	{ symbol: "KUJI", name: "Kujira Governance Token", address: "secret13hvh0rn0rcf5zr486yxlrucvwpzwqu2dsz6zu8", decimals: 6, bankDenom: "ibc/FFA324A40F82EF430CF78D498CE04FF634D2091FCDC04EFEC8841B86011F307A", coingeckoId: "kujira" },
	{ symbol: "NTRN", name: "Neutron Governance Token", address: "secret1k644rvd979wn4erjd5g42uehayjwrq094g5uvj", decimals: 6, bankDenom: "ibc/F1E2912B7740A256EE98F87F464CC50EEB4511CEDFA9512365B2DA93057482DC", coingeckoId: "neutron-3" },
	{ symbol: "NYM", name: "Nym Governance Token", address: "secret19gk280z6j9ywt3ln6fmfwfa36dkqeukcwqdw2k", decimals: 6, bankDenom: "ibc/3D94B1D3EA1E52407BC69A78BC0A52D2440F0524F5268B899B67F18DEACB0B5F", coingeckoId: "nym" },
	{ symbol: "LUNA", name: "Terra Governance Token", address: "secret149e7c5j7w24pljg6em6zj2p557fuyhg8cnk7z8", decimals: 6, bankDenom: "ibc/28DECFA7FB7E3AB58DC3B3AEA9B11C6C6B6E46356DCC26505205DAD3379984F5", coingeckoId: "terra-luna-2" },
	{ symbol: "milkTIA", name: "MilkyWay Staked TIA", address: "secret1h08ru5kul3yajg7tqj6vq9k6rccnfw2yqy8glc", decimals: 6, bankDenom: "ibc/C0DB3E0C7F3CD32FA24FC031FD8B6833627A1C690B741BA85D7A4752D974A77F", coingeckoId: "milkyway-staked-tia" },
	{ symbol: "MNTA", name: "Manta DAO Governance Token", address: "secret15rxfz2w2tallu9gr9zjxj8wav2lnz4gl9pjccj", decimals: 6, bankDenom: "ibc/79F822764AF21756380877295C75F9FEB56BC0020612A7039931E27F30C01BE9", coingeckoId: "mantadao" },
	{ symbol: "ORAI", name: "Oraichain Governance Token", address: "secret1sv0nxz6athw5qm0hsxl90376c9zhrxhhprhjph", decimals: 6, bankDenom: "ibc/C35B578C6388E3061E7E88AF1F0C79074DEC6CF306F57156A2AFE60FB0903532", coingeckoId: "oraichain-token" },
	{ symbol: "OSMO", name: "Osmosis Governance Token", address: "secret150jec8mc2hzyyqak4umv6cfevelr0x9p0mjxgg", decimals: 6, bankDenom: "ibc/0471F1C4E7AFD3F07702BEF6DC365268D64570F7C1FDC98EA6098DD6DE59817B", coingeckoId: "osmosis" },
	{ symbol: "PICA", name: "Picasso Token", address: "secret1e0y9vf4xr9wffyxsvlz35jzl5st2srkdl8frac", decimals: 12, bankDenom: "ibc/7E8714E75B6A303CB074576F08D6FB3FB064C7E936F59AFE273CBB05DECE7151", coingeckoId: "picasso" },
	{ symbol: "pSTAKE", name: "Persistence pSTAKE", address: "secret1umeg3u5y949vz6jkgq0n4rhefsr84ws3duxmnz", decimals: 18, bankDenom: "ibc/9774DCF1E103F4B7E23744AB4B38C18CACF96281FA9305167FC497BC2FC7B888", coingeckoId: "pstake-finance" },
	{ symbol: "qATOM", name: "Quicksilver ATOM Staking Derivative", address: "secret120cyurq25uvhkc7qjx7t28deuqslprxkc4rrzc", decimals: 6, bankDenom: "ibc/97048A1FAFF5D84D4A5DDD9976AD332A3CAD99C81BC5C0C2B82A50E4C2131FB2", coingeckoId: "qatom" },
	{ symbol: "USDC", name: "Native USDC Stablecoin from Noble", address: "secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2", decimals: 6, bankDenom: "ibc/9162FF8AC138FFAB8723606E1FD726A95A2A153831ED6786396C374004AC28F8", coingeckoId: "usd-coin" },
	{ symbol: "SAGA", name: "SAGA Governance Token", address: "secret19gmvklys9uywk3lf2e94wqwwc97r3jr5rwa2pa", decimals: 6, bankDenom: "ibc/5938378D6974EF73519C90789CBBFFFAEC43992A3D2B5E3F465F5DA96E434029", coingeckoId: "saga-2" },
	{ symbol: "STARS", name: "Stargaze Governance Token", address: "secret1x0dqckf2khtxyrjwhlkrx9lwwmz44k24vcv2vv", decimals: 6, bankDenom: "ibc/7EAE5BEF3A26B64AFBD89828AFDDB1DC7024A0276D22745201632C40E6E634D0", coingeckoId: "stargaze" },
	{ symbol: "stATOM", name: "Stride ATOM Staking Derivative", address: "secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq", decimals: 6, bankDenom: "ibc/A0E80E59956C754F1D9CB37234D13E0CF2949E7254896359F284512FA8428E18", coingeckoId: "stride-staked-atom" },
	{ symbol: "stINJ", name: "Stride INJ Staking Derivative", address: "secret1eurddal3m0tphtapad9awgzcuxwz8ptrdx7h4n", decimals: 18, bankDenom: "ibc/7E8DC1B7D29E1FD88496D49CA8045F98EDF5C4D332D64D058BFB7DFCAACE8F46", coingeckoId: "stride-staked-injective" },
	{ symbol: "stJUNO", name: "Stride JUNO Staking Derivative", address: "secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v", decimals: 6, bankDenom: "ibc/9B7F6219D699F608B23382F341E29303D66D5CA81F91D6D0B957119F97569F0F", coingeckoId: "stride-staked-juno" },
	{ symbol: "stkATOM", name: "Persistence ATOM Staking Derivative", address: "secret16vjfe24un4z7d3sp9vd0cmmfmz397nh2njpw3e", decimals: 6, bankDenom: "ibc/DEA3620A6407C63A287A4FE1683D07627F27AF7A83E077B1E51EDFF8833980FE", coingeckoId: "stkatom" },
	{ symbol: "stkDYDX", name: "Persistence dYdX Staking Derivative", address: "secret16dctnuy6lwydw834f4d0t3sw3f6jhav6ryhe4m", decimals: 18, bankDenom: "ibc/770CF5C334866B8760435B1670C3CEEE3A42B4E6C85CB5A71E23F1610B62DB70" },
	{ symbol: "stLUNA", name: "Stride LUNA Staking Derivative", address: "secret1rkgvpck36v2splc203sswdr0fxhyjcng7099a9", decimals: 6, bankDenom: "ibc/C8D8F46E3CE6F41E01E32542215597CF4B32709C8A310F728653CB91FDB8A904", coingeckoId: "stride-staked-luna" },
	{ symbol: "stOSMO", name: "Stride OSMO Staking Derivative", address: "secret1jrp6z8v679yaq65rndsr970mhaxzgfkymvc58g", decimals: 6, bankDenom: "ibc/B0988C39E7418C644FDFD41682A59D22DCAD1BCC7A6429B2EAAA195FB726A2D7", coingeckoId: "stride-staked-osmo" },
	{ symbol: "STRD", name: "Stride Governance Token", address: "secret1rfhgs3ryqt7makakr2qw9zsqq4h5wdqawfa2aa", decimals: 6, bankDenom: "ibc/CE591002C567BE4B8C4EC3F3F3D18AF7A1CA9FADBF5876C8413F8B2BD83CE8FF", coingeckoId: "stride" },
	{ symbol: "stTIA", name: "Stride TIA Staking Derivative", address: "secret1l5d0vncwnlln0tz0m4tp9rgm740xl7th6es0q0", decimals: 6, bankDenom: "ibc/A223651B9E968C94D2C8378DDFAAF619CD215925BB793763A6CD626C7E36ED0C", coingeckoId: "stride-staked-tia" },
	{ symbol: "SWTH", name: "Carbon Governance Token", address: "secret1gech42jfcdke92tf9ltscpq7x0al8j7gkce030", decimals: 8, bankDenom: "ibc/9AD48A1B686F2B6470FCDF6363130842CC96D51F055D3D424F83B936D2A2BBEB", coingeckoId: "switcheo" },
	{ symbol: "SYN", name: "Galactic Syndicate Governance Token", address: "secret1hjcv25hpgqtpwn90tz7pttr9fyz7l9pngzz8rl", decimals: 6, bankDenom: "ibc/F304520D97EBC7FE3BC4404AF2A1338CC9075DA853BCDF30D65662BED5EAEEF5" },
	{ symbol: "TIA", name: "Celestia Governance Token", address: "secret1s9h6mrp4k9gll4zfv5h78ll68hdq8ml7jrnn20", decimals: 6, bankDenom: "ibc/8E31B43C53FA68AFEB6A0A4A61DA67F357A6BD757F745A3CB65B97CD9D9DA1BB", coingeckoId: "celestia" },
	{ symbol: "USDT", name: "Native USDT from Kava", address: "secret1htd6s29m2j9h45knwkyucz98m306n32hx8dww3", decimals: 6, bankDenom: "ibc/0B1830E544F39B2CDD1CE415D1B1A377039E495CE83055C01BF6AE4518C28755", coingeckoId: "tether" },
	{ symbol: "WBTC", name: "Wrapped Bitcoin from Osmosis", address: "secret1v2kgmfwgd2an0l5ddralajg5wfdkemxl2vg4jp", decimals: 8, bankDenom: "ibc/CF57A83CED6CEC7D706631B5DC53ABC21B7EDA7DF7490732B4361E6D5DD19C73", coingeckoId: "bitcoin" },
	{ symbol: "wstETH", name: "Wrapped Lido stETH from Neutron", address: "secret1xx6m5c7d92h75evkmxqqe2xe5sk5qcqqs9t8ar", decimals: 18, bankDenom: "ibc/9AD9D38BE249CB6F0A22A1EB5487E2377B79FADB397444B1F77F29B96F34C2F1", coingeckoId: "wrapped-steth" },
	{ symbol: "XPRT", name: "Persistence Governance Token", address: "secret1gnrrqjj5e2pwn4g262xjyypptu0ge3z3tps3nn", decimals: 6, bankDenom: "ibc/3587AC36A81A13FCFB1D0EC03CEB98AEAAAB1F5275B68C7DC2B40BA6279AA696", coingeckoId: "persistence" },
	{ symbol: "XRP", name: "Ripple XRP via Coreum", address: "secret1gqn3k7792h9vqpydvq6hnh3wr9lqg3s9j6hzy6", decimals: 6, bankDenom: "ibc/178811A87188241F39138EB06BFE7B09BAE5A65E80A48B42F1DB23542C793D1E", coingeckoId: "ripple" },
	{ symbol: "ALTER", name: "ALTER dApp Token", address: "secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr", decimals: 6, coingeckoId: "alter" },
	{ symbol: "AMBER", name: "Amber DAO Token (very rare)", address: "secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852", decimals: 6, coingeckoId: "amberdao" },
	{ symbol: "dSHD", name: "Shade Protocol SHD Staking Derivative", address: "secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq", decimals: 8, coingeckoId: "shade-protocol" },
	{ symbol: "FINA", name: "Fina.cash Token", address: "secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve", decimals: 6, coingeckoId: "fina" },
	{ symbol: "SHD", name: "Shade Protocol Governance Token", address: "secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm", decimals: 8, coingeckoId: "shade-protocol" },
	{ symbol: "SILK", name: "Shade Protocol Privacy-Preserving Stablecoin", address: "secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd", decimals: 6, coingeckoId: "silk-bcec1136-561c-4706-a42c-8b67d0d7f7d2" },
	{ symbol: "stkd-SCRT", name: "Shade Protocol SCRT Staking Derivative", address: "secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4", decimals: 6, coingeckoId: "stkd-scrt" },
	{ symbol: "USDC.axl", name: "USDC stablecoin from Axelar", address: "secret1vkq022x4q8t8kx9de3r84u669l65xnwf2lg3e6", decimals: 6, axelar: true, coingeckoId: "usd-coin" },
	{ symbol: "AXL", name: "Axelar Governance Token", address: "secret1vcau4rkn7mvfwl8hf0dqa9p0jr59983e3qqe3z", decimals: 6, axelar: true, coingeckoId: "axelar" },
	{ symbol: "WETH", name: "Wrapped ETH from Axelar", address: "secret139qfh3nmuzfgwsx2npnmnjl4hrvj3xq5rmq8a0", decimals: 18, axelar: true, coingeckoId: "ethereum" },
	{ symbol: "wstETH.axl", name: "wstETH from Axelar", address: "secret148jzxkagwe0xulf8jt3sw4nuh2shdh788z3gyd", decimals: 18, axelar: true, coingeckoId: "bridged-wrapped-steth-axelar" },
	{ symbol: "WBTC.axl", name: "Wrapped Bitcoin from Axelar", address: "secret1guyayjwg5f84daaxl7w84skd8naxvq8vz9upqx", decimals: 8, axelar: true, coingeckoId: "bitcoin" },
	{ symbol: "WBNB", name: "Wrapped Binance Coin from Axelar", address: "secret19xsac2kstky8nhgvvz257uszt44g0cu6ycd5e4", decimals: 18, axelar: true, coingeckoId: "binancecoin" },
	{ symbol: "BUSD", name: "Binance USD from Axelar", address: "secret1t642ayn9rhl5q9vuh4n2jkx0gpa9r6c3sl96te", decimals: 18, axelar: true, coingeckoId: "busd" },
	{ symbol: "DAI", name: "DAI from Axelar", address: "secret1c2prkwd8e6ratk42l4vrnwz34knfju6hmp7mg7", decimals: 18, axelar: true, coingeckoId: "dai" },
	{ symbol: "LINK", name: "LINK from Axelar", address: "secret1walthx26qaas50nwzg2rsqttlkf58q3hvjha5k", decimals: 18, axelar: true, coingeckoId: "chainlink" },
	{ symbol: "UNI", name: "UNI from Axelar", address: "secret1egqlkasa6xe6efmfp9562sfj07lq44z7jngu5k", decimals: 18, axelar: true, coingeckoId: "uniswap" },
	{ symbol: "USDT.axl", name: "USDT stablecoin from Axelar", address: "secret1wk5j2cntwg2fgklf0uta3tlkvt87alfj7kepuw", decimals: 6, axelar: true, coingeckoId: "tether" },
	{ symbol: "FRAX", name: "FRAX from Axelar", address: "secret16e230j6qm5u5q30pcc6qv726ae30ak6lzq0zvf", decimals: 18, axelar: true, coingeckoId: "frax" },
];

const BY_ADDRESS = new Map(TOKENS.map((t) => [t.address, t]));
const BY_DENOM = (() => {
	const claims = new Map<string, TokenInfo[]>();
	for (const t of TOKENS) if (t.bankDenom) claims.set(t.bankDenom, [...(claims.get(t.bankDenom) ?? []), t]);
	// a denomination claimed by two tokens is ambiguous: never guess which contract to use
	return new Map([...claims].filter(([, ts]) => ts.length === 1).map(([d, ts]) => [d, ts[0]!]));
})();

export function tokenByAddress(address: string): TokenInfo | undefined {
	return BY_ADDRESS.get(address);
}

/** The SNIP-20 a public bank denomination wraps into, e.g. `uscrt` → sSCRT. */
export function tokenForBankDenom(denom: string): TokenInfo | undefined {
	return BY_DENOM.get(denom);
}

/** sSCRT is called sSCRT; every other token goes by its ticker in both forms. */
export function privateSymbol(t: TokenInfo): string {
	return t.address === SSCRT_ADDRESS ? 'sSCRT' : t.symbol;
}

/** What an invoice asks for, as this wallet sees it. */
export interface InvoiceAsset {
	/** canonical id: `uscrt`, `ibc/…` or a SNIP-20 address */
	id: string;
	symbol: string;
	decimals: number;
	private: boolean;
	/** the SNIP-20 the payment is settled through (the token itself, or what the denom wraps into) */
	token: TokenInfo;
}

export function invoiceAsset(id: string | undefined): InvoiceAsset | undefined {
	if (!id) return invoiceAsset(SSCRT_ADDRESS);
	if (id.startsWith('secret1')) {
		const t = tokenByAddress(id);
		return t && { id, symbol: privateSymbol(t), decimals: t.decimals, private: true, token: t };
	}
	const t = tokenForBankDenom(id);
	return t && { id, symbol: t.symbol, decimals: t.decimals, private: false, token: t };
}

// Teach the URI parser every token here, so requests can name them by ticker
// (`asset=silk`) and amounts are checked against the right decimals.
{
	const counts = new Map<string, number>();
	for (const t of TOKENS) counts.set(t.symbol.toLowerCase(), (counts.get(t.symbol.toLowerCase()) ?? 0) + 1);
	for (const t of TOKENS) {
		if (findAsset('secret-4', t.address)) continue;
		const alias = t.symbol.toLowerCase();
		registerAsset('secret-4', {
			id: t.address,
			symbol: privateSymbol(t),
			decimals: t.decimals,
			kind: 'snip20',
			private: true,
			aliases: counts.get(alias) === 1 && !findAsset('secret-4', alias) ? [alias] : [],
		});
		if (t.bankDenom && t.bankDenom.startsWith('ibc/') && tokenForBankDenom(t.bankDenom) === t) {
			registerAsset('secret-4', { id: t.bankDenom, symbol: t.symbol, decimals: t.decimals, kind: 'ibc', private: false, aliases: [] });
		}
	}
}
