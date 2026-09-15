import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDownIcon, HorizontaLDots } from "../icons";
import { useSidebar } from "../context/SidebarContext";
import { useAuth } from "../context/AuthContext";

// 🟢 Importiamo il nostro modale MODIFICARE QUANDO CI SARANNO GLI ASSET SULLA MAPPA 

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  action?: () => void;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

// ==========================================
// 🎨 DEFINIZIONE ICONE SVG VETTORIALI
// ==========================================
const MapIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
  </svg>
);

const DashboardIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 13h6c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1zm0 8h6c.55 0 1-.45 1-1v-4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm10 0h6c.55 0 1-.45 1-1v-8c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1zM13 4v4c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1z" />
  </svg>
);

const UsersIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
  </svg>
);

const CategoryIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z" />
  </svg>
);

const CampusIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 11V3H7v4H3v14h18V11h-4zm-8-6h4v14H9V5zm-4 6h2v2H5v-2zm0 4h2v2H5v-2zm0 4h2v2H5v-2zm12 0h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2z" />
  </svg>
);

const HistoryIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
  </svg>
);

const TicketIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22 10V6c0-1.11-.9-2-2-2H4c-1.1 0-1.99.89-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2s.9-2 2-2zm-2 7.16c-1.27-.72-2-2.11-2-3.66s.73-2.94 2-3.66V6H4v3.84c1.27.72 2 2.11 2 3.66s-.73 2.94-2 3.66V18h16v-1.84zM13 13h2v-2h-2v2zm-4 0h2v-2H9v2z" />
  </svg>
);

const PlusIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9 3.375C9.31066 3.375 9.5625 3.62684 9.5625 3.9375V8.4375H14.0625C14.3732 8.4375 14.625 8.68934 14.625 9C14.625 9.31066 14.3732 9.5625 14.0625 9.5625H9.5625V14.0625C9.5625 14.3732 9.31066 14.625 9 14.625C8.68934 14.625 8.4375 14.3732 8.4375 14.0625V9.5625H3.9375C3.62684 9.5625 3.375 9.31066 3.375 9C3.375 8.68934 3.62684 8.4375 3.9375 8.4375H8.4375V3.9375C8.4375 3.62684 8.68934 3.375 9 3.375Z"
      fill=""
    />
  </svg>
);

const ListIcon = (
  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
  </svg>
);

// 2. Funzione che genera il menu in base al ruolo
const getNavItemsByRole = (role?: string): NavItem[] => {
  // La Mappa è comune a tutti, la mettiamo come base
  const baseMenu: NavItem[] = [
    { icon: MapIcon, name: "Mappa Campus", path: "/map" }
  ];
 
  switch (role) {
    case "AMMINISTRATORE":
      return [
        ...baseMenu,
        { icon: DashboardIcon, name: "Dashboard", path: "/dashboard" },
        { icon: UsersIcon, name: "Gestione Operatori", path: "/admin/operators" },
        { icon: CategoryIcon, name: "Gestione Categorie", path: "/admin/categories" },
        { icon: CampusIcon, name: "Gestione Campus", path: "/admin/campuses" },
        { icon: ListIcon, name: "Lista Assets", path: "/assets/list" },
        { icon: HistoryIcon, name: "Storico Operazioni", path: "/admin/history" }
      ];
    case "OPERATORE":
      return [
        ...baseMenu,
        { icon: TicketIcon, name: "Segnalazioni", path: "/operator/tickets" },
        { icon: PlusIcon, name: "Nuovo Asset", path: "/assets/new" },
        { icon: ListIcon, name: "Lista Assets", path: "/assets/list" }, 
      ];
    case "UTENTE":
    default:
      return [
        ...baseMenu,
      ];
  }
};

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const location = useLocation();

  const { user } = useAuth();
  
  const navItems = getNavItemsByRole(user?.role);

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>({});
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isActive = useCallback(
    (path: string) => location.pathname === path,
    [location.pathname]
  );

  useEffect(() => {
    let submenuMatched = false;
    ["main"].forEach((menuType) => {
      const items = navItems; 
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
  }, [location, isActive]);

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={`menu-item-icon-size  ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            
            nav.path ? (
              <Link
                to={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`menu-item-icon-size ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className="menu-item-text">{nav.name}</span>
                )}
              </Link>
            ) : nav.action ? (
              <button
                onClick={nav.action}
                className="menu-item group menu-item-inactive w-full text-left cursor-pointer"
              >
                <span className="menu-item-icon-size menu-item-icon-inactive">
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className="menu-item-text">{nav.name}</span>
                )}
              </button>
            ) : null
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      to={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`py-8 flex ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
      <Link to="/map" className="flex items-center justify-center w-full py-4">
        {isExpanded || isHovered || isMobileOpen ? (
          <img
            src="/images/logo/logo_unisa.png"
            alt="Logo UNISA"
            width={80}
            className="block mx-auto object-contain" 
          />
        ) : (
          <img
            src="/images/logo/logo_unisa.png"
            alt="Logo UNISA Icona"
            width={32}
            height={32}
            className="block mx-auto object-contain"
          />
        )}
      </Link>
      </div>
      
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            
            {/* Sezione Menu Principale */}
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Menu"
                ) : (
                  <HorizontaLDots className="size-6" />
                )}
              </h2>
              {renderMenuItems(navItems, "main")}
            </div>
            
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;