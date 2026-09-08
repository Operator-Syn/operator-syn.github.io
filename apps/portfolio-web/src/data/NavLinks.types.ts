import type { NavLinkItem } from "../components/navBar/NavBar";
import Agent from "../components/pages/agentPage/Agent";
import Ai from "../components/pages/aiPage/Ai";
import Atelier from "../components/pages/atelierPage/Atelier";
import Certifications from "../components/pages/certificatesPage/Certificates";
import Home from "../components/pages/homePage/Home";
import Netbird from "../components/pages/netbirdPage/Netbird";
import PrivacyPolicy from "../components/pages/privacyPolicyPage/PrivacyPolicy";
import Projects from "../components/pages/projectsPage/Projects";
import Snippets from "../components/pages/snippetsPage/Snippets";
import TermsAndConditions from "../components/pages/termsAndConditionsPage/TermsAndConditions";

export const brandName = "Operator-Syn";

export interface RouteItem extends NavLinkItem {
  showInNav?: boolean;
}

export const routes: RouteItem[] = [
  { name: "Home", path: "/", component: Home, showInNav: true },
  { name: "Projects", path: "/projects", component: Projects, showInNav: true },
  { name: "Certificates", path: "/certificates", component: Certifications, showInNav: true },
  { name: "Snippets", path: "/snippets", component: Snippets, showInNav: true },
  { name: "Privacy", path: "/privacy-policy", component: PrivacyPolicy, showInNav: false },
  { name: "Terms", path: "/terms-and-conditions", component: TermsAndConditions, showInNav: false },
  { name: "NetBird", path: "/netbird", component: Netbird, showInNav: false },
  { name: "Atelier", path: "/atelier", component: Atelier, showInNav: false },
  { name: "AI and MCP", path: "/ai", component: Ai, showInNav: false },
  { name: "Portfolio Assistant", path: "/agent", component: Agent, showInNav: false },
];

export const navLinks: NavLinkItem[] = routes.filter((route) => route.showInNav !== false);
