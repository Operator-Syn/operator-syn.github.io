import type { NavLinkItem as NavLink } from "../components/navBar/NavBar.type";
import Home from "../components/pages/Home";
import profileEncircle from "./../assets/profile-encircle.png";

export const brandName = "Operator-Syn";

export const navLinks: NavLink[] = [
    { name: "Home", path: "/", component: Home },
    { name: "Projects", path: "/projects", component: null },
    { name: "Certificates", path: "/certs", component: null },
    { name: "Snippets", path: "/snippets", component: null },
];

// Home page content
export const homeContent = {
    headerPhrase: "Calm Interfaces, Seamless Experiences — Welcome Visitors!",
    elevatorPitch: [
        {
            title: "Get to know 'lil more about me",
            content: "Hello Everyone! I'm a Third Year Computer Science Student with hands-on experience in Java, C++, Python, and MySQL. I am also comfortable working in Linux environments and using tools like Docker and Apache for development and deployment. Excited to work on real-world software challenges and grow through hands-on experience and team collaboration. Let's connect and explore opportunities to innovate together!",
        },
    ],
    profileImage: profileEncircle,
};

// Development Loadouts content
export const devLoadoutsContent = {
    header: "Development Loadouts",
    sections: [
        {
            category: "Operating Systems",
            badges: [
                "https://img.shields.io/badge/Windows_11-0078d4?style=for-the-badge&logo=windows-11&logoColor=white",
                "https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black",
                "https://img.shields.io/badge/Ubuntu-E95420?style=for-the-badge&logo=ubuntu&logoColor=white",
                "https://img.shields.io/badge/Pop!_OS-48B9C7?style=for-the-badge&logo=Pop!_OS&logoColor=white",
                "https://img.shields.io/badge/Zorin%20OS-0CC1F3?style=for-the-badge&logo=zorin&logoColor=white",
            ],
        },
        {
            category: "Programming Languages",
            badges: [
                "https://img.shields.io/badge/C-00599C?style=for-the-badge&logo=c&logoColor=white",
                "https://img.shields.io/badge/C%2B%2B-00599C?style=for-the-badge&logo=c%2B%2B&logoColor=white",
                "https://img.shields.io/badge/java-%23ED8B00.svg?style=for-the-badge&logo=openjdk&logoColor=white",
                "https://img.shields.io/badge/Python-FFD43B?style=for-the-badge&logo=python&logoColor=blue",
            ],
        },
        {
            category: "Frameworks",
            badges: [
                "https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white",
                "https://img.shields.io/badge/Apache-D22128?style=for-the-badge&logo=Apache&logoColor=white",
                "https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB",
            ],
        },
        {
            category: "Database",
            badges: [
                "https://img.shields.io/badge/MySQL-005C84?style=for-the-badge&logo=mysql&logoColor=white",
            ],
        },
        {
            category: "Virtualization & Containerization",
            badges: [
                "https://img.shields.io/badge/Portainer-13BEF9?style=for-the-badge&logo=portainer&logoColor=white",
                "https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white",
            ],
        },
    ],
};

//Profile Information
export const profileInfo = [
    {label: "Name", value: "John-Ronan Beira"},
    {label: "Program", value: "BS Computer Science"},
    {label: "Year", value: "Third Year"},
]

// Social Links Content
export const socialLinksContent = {
    header: "Social Links",
    badges: [
        {
            href: "https://www.facebook.com/one.young.blue.existing.entity",
            img: "https://img.shields.io/badge/Facebook-1877F2?style=for-the-badge&logo=facebook&logoColor=white",
            alt: "Facebook",
        },
        {
            href: "https://github.com/Operator-Syn",
            img: "https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white",
            alt: "GitHub",
        },
        {
            href: "https://www.instagram.com/rohn_rohnann",
            img: "https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white",
            alt: "Instagram",
        },
        {
            href: "https://www.linkedin.com/in/one-young-blue-existing-entity/",
            img: "https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white",
            alt: "LinkedIn",
        },
        {
            href: "https://discord.com/users/565151069655662622",
            img: "https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white",
            alt: "Discord",
        },
        {
            href: "https://steamcommunity.com/id/one-young-blue-entity/",
            img: "https://img.shields.io/badge/Steam-000000?style=for-the-badge&logo=steam&logoColor=white",
            alt: "Steam",
        },
        {
            href: "https://www.xbox.com/en-PH/play/user/Kashiede",
            img: "https://img.shields.io/badge/Xbox-107C10?style=for-the-badge&logo=xbox&logoColor=white",
            alt: "Xbox",
        },
        {
            href: "https://paypal.me/youngexistingentity?country.x=PH&locale.x=en_US",
            img: "https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white",
            alt: "PayPal",
        },
    ],
};
