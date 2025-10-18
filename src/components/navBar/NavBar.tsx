import { useState, useEffect, useRef } from "react";
import { NavLink, Link } from "react-router-dom";
import Collapse from "bootstrap/js/dist/collapse";
import type { NavBarProps } from "./NavBar.type";
import "./NavBar.css";

export default function NavBar({ brandName, links }: NavBarProps) {

    const [isOpen, setIsOpen] = useState(false);
    const isOpenRef = useRef(isOpen);
    const navbarRef = useRef<HTMLDivElement>(null);
    const togglerRef = useRef<HTMLButtonElement>(null);
    const collapseInstanceRef = useRef<Collapse | null>(null);

    // 1. Create Bootstrap Collapse instance (runs once)
    useEffect(() => {
        if (navbarRef.current) {
            collapseInstanceRef.current = new Collapse(navbarRef.current, {
                toggle: false, // don't auto-toggle
            });
        }
    }, []);

    // 2. Keep isOpenRef in sync with isOpen (runs whenever state changes)
    useEffect(() => {
        isOpenRef.current = isOpen;
    }, [isOpen]);

    // 3. Handle click outside (runs once)
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // Only close if menu is currently open
            if (
                isOpenRef.current &&
                navbarRef.current &&
                !navbarRef.current.contains(event.target as Node) &&
                togglerRef.current &&
                !togglerRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener("click", handleClickOutside);
        return () => document.removeEventListener("click", handleClickOutside);
    }, []);

    // 4. Sync isOpen state with Bootstrap Collapse instance (runs whenever isOpen changes)
    useEffect(() => {
        if (!collapseInstanceRef.current) return;
        isOpen ? collapseInstanceRef.current.show() : collapseInstanceRef.current.hide();
    }, [isOpen]);


    return (
        <nav className="navbar fixed-top navbar-expand-lg glass">
            <div className="container-fluid">
                <Link className="navbar-brand" to="/">{brandName}</Link>

                <button
                    ref={togglerRef}
                    className="navbar-toggler"
                    type="button"
                    aria-controls="navbarNav"
                    aria-expanded={isOpen}
                    aria-label="Toggle navigation"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <span className="navbar-toggler-icon"></span>
                </button>

                <div ref={navbarRef} className="collapse navbar-collapse" id="navbarNav">
                    <ul className="navbar-nav ms-auto">
                        {links.map((link) => (
                            <li key={link.path} className="nav-item">
                                <NavLink
                                    to={link.path}
                                    className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                                    onClick={() => setIsOpen(false)}
                                >
                                    {link.name}
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </nav>
    );
}
