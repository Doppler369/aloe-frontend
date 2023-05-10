import { useContext, useMemo } from 'react';

import { Bridge } from '@socket.tech/plugin';
import { ethers } from 'ethers';
import Modal from 'shared/lib/components/common/Modal';
import { BRIDGE_SUPPORTED_CHAINS } from 'shared/lib/data/constants/ChainSpecific';
import { Token } from 'shared/lib/data/Token';
import { chain } from 'wagmi';

import { ChainContext } from '../../../App';
import { getTokens } from '../../../data/TokenData';

export type BridgeModalProps = {
  isOpen: boolean;
  selectedAsset: Token;
  setIsOpen: (isOpen: boolean) => void;
};

export default function BridgeModal(props: BridgeModalProps) {
  const { isOpen, selectedAsset, setIsOpen } = props;
  const { activeChain } = useContext(ChainContext);
  const provider = new ethers.providers.Web3Provider(window.ethereum as any);

  const supportedChainIds = BRIDGE_SUPPORTED_CHAINS.map((chain) => chain.id);
  const tokens = useMemo(() => {
    return supportedChainIds
      .map((chainId) =>
        getTokens(chainId).map((token) => {
          return { ...token };
        })
      )
      .flat();
  }, [supportedChainIds]);

  if (!provider) {
    return null;
  }

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen} maxWidth='400px'>
      <Bridge
        provider={provider}
        API_KEY={process.env.REACT_APP_SOCKET_API_KEY!}
        customize={{
          primary: 'rgb(13, 23, 30)',
          secondary: 'rgb(26, 41, 52)',
          onInteractive: 'rgb(255, 255, 255)',
          text: 'rgb(255, 255, 255)',
          secondaryText: 'rgb(255, 255, 255)',
          interactive: 'rgb(26, 41, 52)',
          fontFamily: 'Satoshi-Variable',
        }}
        defaultSourceNetwork={chain.mainnet.id}
        defaultDestNetwork={activeChain.id}
        sourceNetworks={supportedChainIds}
        destNetworks={supportedChainIds}
        tokenList={tokens}
        defaultDestToken={selectedAsset.address}
      />
    </Modal>
  );
}