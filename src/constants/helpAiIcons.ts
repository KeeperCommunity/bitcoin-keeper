import type { HelpIconType } from 'src/models/interfaces/HelpAi';
import ChatIcon from 'src/assets/images/chatIcons/chat.svg';
import ClockIcon from 'src/assets/images/chatIcons/clock.svg';
import DownloadIcon from 'src/assets/images/chatIcons/download.svg';
import LinkIcon from 'src/assets/images/chatIcons/link.svg';
import LightbulbIcon from 'src/assets/images/chatIcons/lightbulb.svg';
import ShieldIcon from 'src/assets/images/chatIcons/shield.svg';
import KeyIcon from 'src/assets/images/chatIcons/key.svg';
import WalletIcon from 'src/assets/images/chatIcons/wallet.svg';
import AlertIcon from 'src/assets/images/chatIcons/alert.svg';
import HardwareIcon from 'src/assets/images/chatIcons/hardware.svg';
import InheritanceIcon from 'src/assets/images/chatIcons/inheritance.svg';
import VaultIcon from 'src/assets/images/chatIcons/vault.svg';
import FeeIcon from 'src/assets/images/chatIcons/fee.svg';
import AddressIcon from 'src/assets/images/chatIcons/address.svg';
import NodeIcon from 'src/assets/images/chatIcons/node.svg';

export const HELP_AI_ICON_MAP: Record<
  HelpIconType,
  React.ComponentType<{ width?: number; height?: number }>
> = {
  chat: ChatIcon,
  clock: ClockIcon,
  download: DownloadIcon,
  link: LinkIcon,
  lightbulb: LightbulbIcon,
  shield: ShieldIcon,
  key: KeyIcon,
  wallet: WalletIcon,
  alert: AlertIcon,
  hardware: HardwareIcon,
  inheritance: InheritanceIcon,
  vault: VaultIcon,
  fee: FeeIcon,
  address: AddressIcon,
  node: NodeIcon,
};

export function getThreadIconType(
  messages: Array<{ type: string; iconType?: HelpIconType }> = []
): HelpIconType {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const item = messages[idx];
    if (item?.type === 'ai' && item.iconType && item.iconType in HELP_AI_ICON_MAP) {
      return item.iconType as HelpIconType;
    }
  }
  return 'chat';
}
