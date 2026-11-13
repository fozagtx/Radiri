import Link from "next/link";
import { AuroraHero } from "@/components/ui/aurora-hero";
import { NotchNavbar } from "@/components/ui/notch-navbar";
import { LiveQuote } from "@/components/landing/live-quote";
import { RadiriMark } from "@/components/landing/mark";
import { RevealObserver } from "@/components/landing/reveal";
import { CloudMark, IntentsMark, RegistryMark, RheaMark, RpcMark } from "@/components/landing/venue-marks";

export default function LandingPage() {
  return (
    <>
      <RevealObserver />
      <NotchNavbar />

      <div className="lp-bg" aria-hidden>
        <AuroraHero className="lp-bg-aurora" showTitle={false} />
      </div>

      <section className="lp-hero" id="top">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-rise">Settlement on NEAR, liquidity across chains</p>
            <h1 className="lp-rise d1">
              Compare stablecoin
              <br />
              routes across chains.
            </h1>
            <p className="lp-sub lp-rise d2">
              Enter a pair and a size. Radiri quotes NEAR Intents across chains and Rhea on NEAR,
              prices both in basis points, and shows which one fills. Execution stays in your own
              wallet, and a route that has no liquidity at your size says so.
            </p>
            <div className="lp-actions lp-rise d3">
              <Link className="lp-btn lp-btn--ink" href="/dashboard">
                Quote your size
              </Link>
              <a className="lp-btn lp-btn--outline" href="#how">
                See how it works
              </a>
            </div>
          </div>

          <LiveQuote />
        </div>
      </section>

      <div className="lp-venues">
        <p>Sources and rails</p>
        <div className="lp-venues-row">
          <span>
            <IntentsMark /> NEAR Intents 1Click
          </span>
          <span>
            <RheaMark /> Rhea Smart Router
          </span>
          <span>
            <CloudMark /> NEAR AI Cloud
          </span>
          <span>
            <RegistryMark /> Radiri registry
          </span>
          <span>
            <RpcMark /> FastNEAR RPC
          </span>
        </div>
      </div>

      <section className="lp-wash" id="how">
        <div className="lp-inner lp-reveal">
          <h2>How the aggregator scores a route</h2>
          <p className="lp-lead">
            Both sources are queried in parallel for the size you enter. The engine converts each
            quote into the same unit, basis points against a 1:1 peg, then ranks them and records
            the round.
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
                  <span className="orb">1Clk</span>
                  <em>Intents</em>
                </div>
                <div className="lp-node" style={{ right: "4%", top: "12%" }}>
                  <span className="orb">bps</span>
                  <em>normalize</em>
                </div>
                <div className="lp-node" style={{ left: "4%", bottom: "12%" }}>
                  <span className="orb">Rhea</span>
                  <em>pools</em>
                </div>
                <div className="lp-node" style={{ right: "4%", bottom: "12%" }}>
                  <span className="orb">NEAR</span>
                  <em>registry</em>
                </div>
              </div>
            </div>

            <div className="lp-cell">
              <div className="big">2 sources</div>
              <p className="small">Intents solvers and NEAR AMM pools quoted on every request.</p>
            </div>
            <div className="lp-cell">
              <div className="big">1 unit</div>
              <p className="small">Everything expressed in basis points, so routes are comparable.</p>
            </div>
            <div className="lp-cell">
              <div className="big">32 pairs</div>
              <p className="small">One matrix sweep at your size, gaps listed across all of them.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Size aware</div>
              <p className="small">A route that fills 10,000 may have nothing at 100,000.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Dry runs</div>
              <p className="small">Quotes only. No deposit, no signature, no funds moved.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Access control</div>
              <p className="small">
                The monitor writes with a key limited to one method. Owner and reporter are
                different accounts.
              </p>
            </div>
            <div className="lp-cell">
              <div className="big">On chain</div>
              <p className="small">Each round is written to a NEAR contract by a reporter key.</p>
            </div>
            <div className="lp-cell">
              <div className="big">Analyst</div>
              <p className="small">NEAR AI Cloud reads the quote in a TEE and explains the spread.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-inner lp-reveal" id="engine">
        <h2>The same engine behind every request</h2>
        <p className="lp-lead">
          The dashboard, the matrix sweep and the monitor all call one comparison engine. Nothing
          is cached into a screenshot, and no number is written by hand.
        </p>
        <div className="lp-feats">
          <div className="lp-feat">
            <span className="step">01</span>
            <h3>Parallel quotes</h3>
            <p>
              Each source is asked at the same moment for the same size, so a slow or failing
              venue never hides the other one.
            </p>
          </div>
          <div className="lp-feat">
            <span className="step">02</span>
            <h3>Findings, not vibes</h3>
            <p>
              Liquidity gaps, expensive routes, cross-chain spreads and source divergence are
              derived from the quotes themselves, never assumed.
            </p>
          </div>
          <div className="lp-feat">
            <span className="step">03</span>
            <h3>History you can check</h3>
            <p>
              The monitor records each round on a NEAR registry contract with a reporter key that
              can only call one method.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-inner lp-faq lp-reveal" id="faq">
        <h2>FAQs</h2>
        <div className="lp-faq-item">
          <strong>What is Radiri?</strong>
          <span>
            An aggregator for stablecoin liquidity on NEAR. It quotes NEAR Intents 1Click and the
            Rhea Smart Router for the same pair and size, then shows which one fills and at what
            cost.
          </span>
        </div>
        <div className="lp-faq-item">
          <strong>Why do the two sources disagree?</strong>
          <span>
            They are different kinds of liquidity. 1Click routes through cross-chain solvers, Rhea
            routes through NEAR AMM pools. Above a certain size one runs dry before the other.
          </span>
        </div>
        <div className="lp-faq-item">
          <strong>Does Radiri execute trades?</strong>
          <span>
            No. Every quote is a dry run and the app never signs. Execution is a link out to
            intents.near.org, where you act in your own wallet.
          </span>
        </div>
        <div className="lp-faq-item">
          <strong>Is the registry contract deployed?</strong>
          <span>
            Built and tested, deployment to testnet is the remaining step. Until it is live the
            snapshot panel reports that instead of showing rows.
          </span>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Radiri · Cross-chain stablecoin liquidity aggregator · NEAR HACKATHON 2026</span>
        <span>
          <Link href="/dashboard">Dashboard</Link> ·{" "}
          <a href="https://github.com/fozagtx/Radiri" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </footer>
    </>
  );
}
