declare module 'react-native-zeroconf' {
  export enum ImplType {
    DNSSD = 'DNSSD',
    NSD = 'NSD',
  }

  export interface ZeroconfService {
    name: string;
    fullName?: string;
    port: number;
    addresses?: string[];
    txt?: Record<string, string | number | boolean>;
  }

  export default class Zeroconf {
    on(event: 'resolved', listener: (service: ZeroconfService) => void): void;
    on(event: 'remove', listener: (name: string) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    scan(type: string, protocol: string, domain: string, implementation?: ImplType): void;
    stop(implementation?: ImplType): void;
    removeDeviceListeners(): void;
  }
}
