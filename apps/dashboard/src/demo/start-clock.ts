import { freezeClock } from './clock';

// Its own module, imported first: the demo data is built at import time and must see the frozen clock.
freezeClock();
