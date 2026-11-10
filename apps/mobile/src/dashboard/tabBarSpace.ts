import { createContext, useContext } from 'react';

/**
 * Height covered by the floating tab bar at the bottom of the dashboard. Pages
 * pad their scroll content by this much so their last item clears the bar,
 * while the content still scrolls behind the glass.
 */
export const TabBarSpaceContext = createContext(0);

/** Bottom padding for a page's main scroll content. */
export const useTabBarPadding = (extra = 0) => ({
  paddingBottom: useContext(TabBarSpaceContext) + extra,
});
