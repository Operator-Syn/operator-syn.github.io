import { ArrowRight, Compass, Home as HomeIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import CookingArea from "../../cookingArea/CookingArea";
import GlobalHeadManager from "../../globalHeadManager/GlobalHeadManager";
import TransitionNavLink from "../../pageTransition/TransitionNavLink";
import PointerCoordinates from "../../pointerCoordinates/PointerCoordinates";
import "./NotFound.css";

const NOT_FOUND_DESCRIPTION =
  "The requested Syn-Forge page could not be found. Return to the portfolio home or open the public AI guide.";

const RECOVERY_ROUTES = [
  {
    name: "Home",
    path: "/",
    description: "Start with the portfolio identity",
  },
  {
    name: "Projects",
    path: "/projects",
    description: "Browse selected work",
  },
  {
    name: "Snippets",
    path: "/snippets",
    description: "Read working notes and experiments",
  },
  {
    name: "AI + MCP",
    path: "/ai",
    description: "Open the public guide for AI tools",
  },
  {
    name: "Feilhann Agent",
    path: "/agent",
    description: "Review the authenticated assistant",
  },
] as const;

export default function NotFound() {
  const { hash, pathname, search } = useLocation();
  const requestedPath = `${pathname || "/"}${search}${hash}`;

  return (
    <>
      <GlobalHeadManager
        description={NOT_FOUND_DESCRIPTION}
        robots="noindex, nofollow"
        title="Page not found"
      />

      <CookingArea>
        <main aria-labelledby="not-found-title" className="not-found-page">
          <PointerCoordinates className="not-found-coordinates" markerCount={0} />

          <section aria-describedby="not-found-description" className="not-found-panel">
            <div className="not-found-story">
              <h1 id="not-found-title">This path left the archive.</h1>
              <p className="not-found-status">404 / No matching page</p>
              <p className="not-found-lede" id="not-found-description">
                We couldn’t find a public page at this address. Use a known path below to get back
                to the work.
              </p>

              <div className="not-found-request">
                <span className="not-found-request-label">Requested address</span>
                <code>{requestedPath}</code>
              </div>

              <div className="not-found-actions">
                <TransitionNavLink className="not-found-link action-signal" to="/">
                  <HomeIcon aria-hidden="true" size={16} />
                  Return home
                </TransitionNavLink>
                <TransitionNavLink className="not-found-link action-quiet" to="/ai">
                  <Compass aria-hidden="true" size={16} />
                  Read AI guide
                </TransitionNavLink>
              </div>
            </div>

            <aside aria-labelledby="not-found-map-title" className="not-found-map">
              <div className="not-found-map-header">
                <h2 id="not-found-map-title">Known paths</h2>
                <span>Public entry points</span>
              </div>

              <div aria-hidden="true" className="not-found-map-signal">
                <span>404</span>
                <small>NO MATCH / ARCHIVE</small>
              </div>

              <nav aria-label="Archive destinations">
                <ol className="not-found-route-list">
                  {RECOVERY_ROUTES.map((route, index) => (
                    <li key={route.path}>
                      <TransitionNavLink
                        className="not-found-route-link"
                        end={route.path === "/"}
                        to={route.path}
                      >
                        <span className="not-found-route-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="not-found-route-copy">
                          <span>{route.name}</span>
                          <small>{route.description}</small>
                        </span>
                        <ArrowRight aria-hidden="true" size={17} />
                      </TransitionNavLink>
                    </li>
                  ))}
                </ol>
              </nav>

              <p className="not-found-map-footnote">
                The archive is still here. Start with a path that is known to work.
              </p>
            </aside>
          </section>
        </main>
      </CookingArea>
    </>
  );
}
