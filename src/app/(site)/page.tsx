import Link from "next/link";
import { AuroraHero } from "@/components/ui/aurora-hero";
import { NotchNavbar } from "@/components/ui/notch-navbar";
import { LiveQuote } from "@/components/landing/live-quote";
import { RadiriMark } from "@/components/landing/mark";
import { RevealObserver } from "@/components/landing/reveal";
import { AssetStrip } from "@/components/landing/asset-strip";
import { LiveTicker } from "@/components/app/live-ticker";

export default function LandingPage() {
  return (
    <>
      <RevealObserver />
      <NotchNavbar />

      <AuroraHero className="lp-hero" id="top">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-rise">Meme coins and tokenized stocks, settled on NEAR</p>
            <h1 className="lp-rise d1">
              Borrow stocks against
              <br />
              your meme coins.
            </h1>
            <p className="lp-sub lp-rise d2">
              Keep your PEPE and borrow tokenized Apple, or lock tokenized stocks and borrow meme coins.
              Swap between them across chains through NEAR Intents.
            </p>
            <div className="lp-actions lp-rise d3">
              <Link className="lp-btn lp-btn--ink" href="/overview">
                Open the app
              </Link>
              <a className="lp-btn lp-btn--outline" href="#how">
                See how it works
              </a>
            </div>
          </div>

          <LiveQuote />
        </div>
      </AuroraHero>

      <LiveTicker />
      <AssetStrip />

      <section className="lp-wash" id="how">
        <div className="lp-inner lp-reveal">
          <h2>Three things you can do</h2>
          <p className="lp-lead">
            Collateral, debt and prices live in one NEAR contract. Swaps go through NEAR Intents,
            which routes your meme coin on one chain into a tokenized stock on another.
          </p>

          <div className="lp-bento">
            <div className="lp-cell lp-cell--flow">
              <div className="lp-flow">
                <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
                  <path className="lp-flow-line" d="M200 150 C 150 150 120 100 55 74" />
                  <path className="lp-flow-line" d="M200 150 C 250 150 280 100 345 74" />
                  <path className="lp-flow-line" d="M200 150 C 150 150 120 200 55 226" />
                  <path className="lp-flow-line" d="M200 150 C 250 150 280 200 345 226" />
                  <path className="lp-flow-hot" d="M200 150 C 150 150 120 100 55 74" />
                  <path className="lp-flow-hot" d="M200 150 C 250 150 280 200 345 226" />
                </svg>

                <div className="lp-hub">
                  <span className="orb">
                    <RadiriMark size={30} />
                  </span>
                  <em>Radiri</em>
                </div>

                <div className="lp-node" style={{ left: "4%", top: "12%" }}>
                  <span className="orb">PEPE</span>
                  <em>meme</em>
                </div>
                <div className="lp-node" style={{ right: "4%", top: "12%" }}>
                  <span className="orb">AAPL</span>
                  <em>stock</em>
                </div>
                <div className="lp-node" style={{ left: "4%", bottom: "12%" }}>
                  <span className="orb">1Clk</span>
                  <em>Intents</em>
                </div>
                <div className="lp-node" style={{ right: "4%", bottom: "12%" }}>
                  <span className="orb">NEAR</span>
                  <em>lending</em>
                </div>
              </div>
            </div>

            <div className="lp-cell">
              <div className="big">Meme → stock</div>
              <p className="small">Deposit meme coins as collateral and borrow tokenized stocks.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Stock → meme</div>
              <p className="small">Deposit tokenized stocks as collateral and borrow meme coins.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Cross-chain</div>
              <p className="small">PEPE on Ethereum to tokenized Apple on BNB Chain, in one swap.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Per-asset risk</div>
              <p className="small">Each asset has its own LTV, liquidation threshold and bonus.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Fresh prices</div>
              <p className="small">A stale price blocks borrowing and liquidation, never authorises them.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Health factor</div>
              <p className="small">Positions below 1.00 can be liquidated, with a bonus for the liquidator.</p>
            </div>
            <div className="lp-cell">
              <div className="big">On chain</div>
              <p className="small">Collateral and debt are read from the contract, never from a database.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Your keys</div>
              <p className="small">Every deposit, borrow and swap is signed in your own wallet.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-inner lp-reveal" id="engine">
        <h2>How a borrow works</h2>
        <p className="lp-lead">
          The contract checks every borrow and withdrawal against fresh prices, the asset&apos;s risk
          parameters and the pool&apos;s liquidity before any token moves.
        </p>
        <div className="lp-feats">
          <div className="lp-feat">
            <span className="step">01</span>
            <h3>Deposit collateral</h3>
            <p>
              Send meme coins or tokenized stocks to the lending contract. They stay locked and
              keep counting as yours until the debt is repaid.
            </p>
          </div>
          <div className="lp-feat">
            <span className="step">02</span>
            <h3>Borrow against it</h3>
            <p>
              Your borrowing power is the collateral value times its LTV. Pick a stock or a meme
              coin and borrow up to that limit, if the pool has the liquidity.
            </p>
          </div>
          <div className="lp-feat">
            <span className="step">03</span>
            <h3>Repay, then withdraw</h3>
            <p>
              Interest accrues on the debt. Repay any time; collateral comes back once the
              remaining debt allows it.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-inner lp-faq lp-reveal" id="faq">
        <h2>FAQs</h2>
        <div className="lp-faq-item">
          <strong>What is Radiri?</strong>
          <span>
            A NEAR app that connects meme coins and tokenized stocks: borrow stocks against meme
            coins, borrow meme coins against stocks, and swap one for the other across chains.
          </span>
        </div>
        <div className="lp-faq-item">
          <strong>Which tokenized stocks?</strong>
          <span>
            Swaps use the Ondo Global Markets stocks NEAR Intents lists, such as AAPLon, TSLAon and
            NVDAon on BNB Chain. Availability depends on your region and on NEAR Intents.
          </span>
        </div>
        <div className="lp-faq-item">
          <strong>Is lending live with real assets?</strong>
          <span>
            Not yet. The lending contract runs on NEAR testnet with test tokens that have no value;
            their prices mirror the real PEPE, WIF, Apple, Tesla and NVIDIA prices. Swaps are real
            and run on mainnet.
          </span>
        </div>
        <div className="lp-faq-item">
          <strong>Who holds my funds?</strong>
          <span>
            You sign every transaction in your own wallet. Collateral sits in the lending contract,
            and swaps settle through NEAR Intents to the address you choose.
          </span>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Radiri · Borrow and swap meme coins and tokenized stocks · NEAR HACKATHON 2026</span>
        <span>
          <Link href="/overview">App</Link> ·{" "}
          <a href="https://github.com/fozagtx/Radiri" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </footer>
    </>
  );
}
