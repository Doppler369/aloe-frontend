import { useEffect, useMemo, useState } from 'react';
import { useContext } from 'react';

import { SendTransactionResult } from '@wagmi/core';
import { ethers } from 'ethers';
import JSBI from 'jsbi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { borrowerAbi } from 'shared/lib/abis/Borrower';
import { borrowerLensAbi } from 'shared/lib/abis/BorrowerLens';
import { lenderLensAbi } from 'shared/lib/abis/LenderLens';
import AppPage from 'shared/lib/components/common/AppPage';
import { LABEL_TEXT_COLOR } from 'shared/lib/components/common/Modal';
import { Text } from 'shared/lib/components/common/Typography';
import {
  ALOE_II_LENDER_LENS_ADDRESS,
  ALOE_II_BORROWER_LENS_ADDRESS,
  ALOE_II_ORACLE_ADDRESS,
} from 'shared/lib/data/constants/ChainSpecific';
import { GetNumericFeeTier } from 'shared/lib/data/FeeTier';
import { GN } from 'shared/lib/data/GoodNumber';
import { useChainDependentState } from 'shared/lib/data/hooks/UseChainDependentState';
import { useDebouncedEffect } from 'shared/lib/data/hooks/UseDebouncedEffect';
import useSafeState from 'shared/lib/data/hooks/UseSafeState';
import { Token } from 'shared/lib/data/Token';
import { getEtherscanUrlForChain } from 'shared/lib/util/Chains';
import styled from 'styled-components';
import { Address, useAccount, useContract, useProvider, useContractRead, useBalance } from 'wagmi';

import { ChainContext } from '../App';
import { ReactComponent as InfoIcon } from '../assets/svg/info.svg';
import BorrowGraph, { BorrowGraphData } from '../components/advanced/BorrowGraph';
import { BorrowGraphPlaceholder } from '../components/advanced/BorrowGraphPlaceholder';
import { BorrowMetrics } from '../components/advanced/BorrowMetrics';
import GlobalStatsTable from '../components/advanced/GlobalStatsTable';
import ManageAccountButtons from '../components/advanced/ManageAccountButtons';
import AddCollateralModal from '../components/advanced/modal/AddCollateralModal';
import BorrowModal from '../components/advanced/modal/BorrowModal';
import NewSmartWalletModal from '../components/advanced/modal/NewSmartWalletModal';
import RemoveCollateralModal from '../components/advanced/modal/RemoveCollateralModal';
import RepayModal from '../components/advanced/modal/RepayModal';
import WithdrawAnteModal from '../components/advanced/modal/WithdrawAnteModal';
import SmartWalletButton, { NewSmartWalletButton } from '../components/advanced/SmartWalletButton';
import { UniswapPositionList } from '../components/advanced/UniswapPositionList';
import PendingTxnModal, { PendingTxnModalStatus } from '../components/common/PendingTxnModal';
import { computeLTV } from '../data/BalanceSheet';
import { BorrowerNftBorrower, fetchListOfBorrowerNfts } from '../data/BorrowerNft';
import { RESPONSIVE_BREAKPOINT_MD, RESPONSIVE_BREAKPOINT_SM } from '../data/constants/Breakpoints';
import { TOPIC0_UPDATE_ORACLE } from '../data/constants/Signatures';
import { primeUrl } from '../data/constants/Values';
import useAvailablePools from '../data/hooks/UseAvailablePools';
import { fetchBorrowerDatas } from '../data/MarginAccount';
import { fetchMarketInfoFor, MarketInfo } from '../data/MarketInfo';
import {
  fetchUniswapNFTPositions,
  fetchUniswapPositions,
  UniswapNFTPosition,
  UniswapPosition,
  UniswapPositionPrior,
} from '../data/Uniswap';

const SECONDARY_COLOR = 'rgba(130, 160, 182, 1)';
const BORROW_TITLE_TEXT_COLOR = 'rgba(130, 160, 182, 1)';
const TOPIC1_PREFIX = '0x000000000000000000000000';
const FETCH_UNISWAP_POSITIONS_DEBOUNCE_MS = 500;
const SELECTED_MARGIN_ACCOUNT_KEY = 'account';

const ExplainerWrapper = styled.div`
  display: flex;
  flex-direction: row;
  position: relative;

  padding: 16px;
  margin-top: 1rem;
  margin-bottom: 2rem;

  background-color: rgba(10, 20, 27, 1);
  border-radius: 8px;

  &:before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: 8px;
    /* 1.25px instead of 1px since it avoids the buggy appearance */
    padding: 1.25px;
    background: linear-gradient(90deg, #9baaf3 0%, #7bd8c0 100%);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }
`;

const Container = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 64px;
  max-width: 1280px;
  margin: 0 auto;

  @media (max-width: ${RESPONSIVE_BREAKPOINT_MD}) {
    gap: 32px;
  }

  @media (max-width: ${RESPONSIVE_BREAKPOINT_SM}) {
    flex-direction: column;
    gap: 0;
    align-items: center;
  }
`;

const PageGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  grid-template-rows: auto auto auto auto auto;
  grid-template-areas:
    'monitor graph'
    'metrics metrics'
    'uniswap uniswap'
    'stats stats'
    'link link';
  flex-grow: 1;
  margin-top: 26px;

  @media (max-width: ${RESPONSIVE_BREAKPOINT_MD}) {
    width: 100%;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
    grid-template-areas:
      'monitor'
      'graph'
      'metrics'
      'uniswap'
      'stats'
      'link';
  }
`;

const StyledExternalLink = styled.a`
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 100%;
  &:hover {
    text-decoration: underline;
  }
`;

const SmartWalletsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;

  @media (max-width: ${RESPONSIVE_BREAKPOINT_SM}) {
    width: 100%;
  }
`;

const SmartWalletsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: max-content;
  min-width: 280px;
`;

const MonitorContainer = styled.div`
  grid-area: monitor;
  margin-bottom: 64px;
  display: flex;
  flex-direction: column;
  gap: 32px;
`;

const GraphContainer = styled.div`
  grid-area: graph;
  margin-bottom: 64px;
`;

const MetricsContainer = styled.div`
  grid-area: metrics;
  margin-bottom: 64px;
`;

const UniswapPositionsContainer = styled.div`
  grid-area: uniswap;
  margin-bottom: 64px;
`;

const StatsContainer = styled.div`
  grid-area: stats;
`;

const LinkContainer = styled.div`
  grid-area: link;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
`;

export type UniswapPoolInfo = {
  token0: Token;
  token1: Token;
  fee: number;
};

export default function AdvancedPage() {
  const { activeChain } = useContext(ChainContext);
  const provider = useProvider({ chainId: activeChain.id });
  const { address: userAddress, isConnected } = useAccount();

  const [cachedGraphDatas, setCachedGraphDatas] = useSafeState<Map<string, BorrowGraphData[]>>(new Map());
  const [graphData, setGraphData] = useSafeState<BorrowGraphData[] | null>(null);
  const [borrowerNftBorrowers, setBorrowerNftBorrowers] = useChainDependentState<BorrowerNftBorrower[] | null>(
    null,
    activeChain.id
  );
  const [cachedUniswapPositionsMap, setCachedUniswapPositionsMap] = useSafeState<
    Map<string, readonly UniswapPosition[]>
  >(new Map());
  const [isLoadingUniswapPositions, setIsLoadingUniswapPositions] = useSafeState(true);
  const [uniswapPositions, setUniswapPositions] = useSafeState<readonly UniswapPosition[]>([]);
  const [uniswapNFTPositions, setUniswapNFTPositions] = useSafeState<Map<number, UniswapNFTPosition>>(new Map());
  const [cachedMarketInfos, setCachedMarketInfos] = useSafeState<Map<string, MarketInfo>>(new Map());
  const [selectedMarketInfo, setSelectedMarketInfo] = useSafeState<MarketInfo | undefined>(undefined);
  const [newSmartWalletModalOpen, setNewSmartWalletModalOpen] = useState(false);
  const [isAddCollateralModalOpen, setIsAddCollateralModalOpen] = useState(false);
  const [isRemoveCollateralModalOpen, setIsRemoveCollateralModalOpen] = useState(false);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const [isRepayModalOpen, setIsRepayModalOpen] = useState(false);
  const [isWithdrawAnteModalOpen, setIsWithdrawAnteModalOpen] = useState(false);
  const [isPendingTxnModalOpen, setIsPendingTxnModalOpen] = useSafeState(false);
  const [pendingTxn, setPendingTxn] = useState<SendTransactionResult | null>(null);
  const [pendingTxnModalStatus, setPendingTxnModalStatus] = useSafeState<PendingTxnModalStatus | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const navigate = useNavigate();

  const selectedMarginAccount = useMemo(() => {
    const marginAccountSearchParam = searchParams.get(SELECTED_MARGIN_ACCOUNT_KEY);
    if (!marginAccountSearchParam) return borrowerNftBorrowers?.[0];
    return (
      borrowerNftBorrowers?.find((account) => account.address === marginAccountSearchParam) ?? borrowerNftBorrowers?.[0]
    );
  }, [borrowerNftBorrowers, searchParams]);

  const borrowerLensContract = useContract({
    abi: borrowerLensAbi,
    address: ALOE_II_BORROWER_LENS_ADDRESS[activeChain.id],
    signerOrProvider: provider,
  });
  const { data: uniswapPositionTicks } = useContractRead({
    address: selectedMarginAccount?.address ?? '0x',
    abi: borrowerAbi,
    functionName: 'getUniswapPositions',
    chainId: activeChain.id,
    enabled: Boolean(selectedMarginAccount),
  });

  const availablePools = useAvailablePools();

  // MARK: Fetch margin accounts
  useEffect(() => {
    (async () => {
      if (borrowerLensContract == null || userAddress === undefined || availablePools.size === 0) return;
      const chainId = (await provider.getNetwork()).chainId;

      const borrowerNfts = await fetchListOfBorrowerNfts(chainId, provider, userAddress);
      const borrowers = await fetchBorrowerDatas(
        chainId,
        provider,
        borrowerNfts.map((x) => x.borrowerAddress),
        availablePools
      );

      const fetchedBorrowerNftBorrowers: BorrowerNftBorrower[] = borrowers.map((borrower, i) => ({
        ...borrower,
        tokenId: borrowerNfts[i].tokenId,
        index: borrowerNfts[i].index,
      }));
      setBorrowerNftBorrowers(fetchedBorrowerNftBorrowers);
    })();
  }, [userAddress, borrowerLensContract, provider, availablePools, setBorrowerNftBorrowers]);

  // MARK: Reset search param if margin account doesn't exist
  useEffect(() => {
    if (
      borrowerNftBorrowers?.length &&
      selectedMarginAccount?.address !== searchParams.get(SELECTED_MARGIN_ACCOUNT_KEY)
    ) {
      searchParams.delete(SELECTED_MARGIN_ACCOUNT_KEY);
      setSearchParams(searchParams);
    }
  }, [borrowerNftBorrowers?.length, searchParams, selectedMarginAccount, setSearchParams]);

  // MARK: Fetch market info
  useEffect(() => {
    const cachedMarketInfo = cachedMarketInfos.get(selectedMarginAccount?.address ?? '');
    if (cachedMarketInfo !== undefined) {
      setSelectedMarketInfo(cachedMarketInfo);
      return;
    }
    (async () => {
      if (selectedMarginAccount == null) return;
      const lenderLensContract = new ethers.Contract(
        ALOE_II_LENDER_LENS_ADDRESS[activeChain.id],
        lenderLensAbi,
        provider
      );
      const result = await fetchMarketInfoFor(
        lenderLensContract,
        selectedMarginAccount.lender0,
        selectedMarginAccount.lender1,
        selectedMarginAccount.token0.decimals,
        selectedMarginAccount.token1.decimals
      );
      setCachedMarketInfos((prev) => {
        return new Map(prev).set(selectedMarginAccount.address, result);
      });
      setSelectedMarketInfo(result);
    })();
  }, [selectedMarginAccount, provider, cachedMarketInfos, activeChain.id, setSelectedMarketInfo, setCachedMarketInfos]);

  // MARK: Fetch GraphData
  useEffect(() => {
    const cachedGraphData = cachedGraphDatas.get(selectedMarginAccount?.address ?? '');
    if (cachedGraphData !== undefined) {
      setGraphData(cachedGraphData);
      return;
    }
    (async () => {
      if (selectedMarginAccount == null) return;

      const chainId = (await provider.getNetwork()).chainId;
      const updateLogs = await provider.getLogs({
        address: ALOE_II_ORACLE_ADDRESS[chainId],
        topics: [TOPIC0_UPDATE_ORACLE, `${TOPIC1_PREFIX}${selectedMarginAccount?.uniswapPool.slice(2)}`],
        fromBlock: 0,
        toBlock: 'latest',
      });

      const blockI = updateLogs.at(0);
      const blockF = updateLogs.at(-1);

      if (blockI === undefined || blockF === undefined) return;

      const [tI, tF] = await Promise.all(
        [blockI, blockF].map(async (log) => {
          return (await provider.getBlock(log.blockNumber)).timestamp;
        })
      );

      const results = await Promise.all(
        updateLogs.map(async (result) => {
          const approxTime = tI + ((tF - tI) / (blockF.blockNumber - blockI.blockNumber)) * result.blockNumber;

          const decoded = ethers.utils.defaultAbiCoder.decode(['uint160', 'uint256'], result.data);
          const iv = ethers.BigNumber.from(decoded[1]).div(1e6).toNumber() / 1e6;
          const ltv = computeLTV(iv, selectedMarginAccount.nSigma);

          const resultData: BorrowGraphData = {
            IV: iv * Math.sqrt(365) * 100,
            LTV: ltv * 100,
            x: new Date(approxTime * 1000),
          };
          return resultData;
        })
      );
      setCachedGraphDatas((prev) => {
        return new Map(prev).set(selectedMarginAccount.address, results);
      });
      setGraphData(results);
    })();
  }, [activeChain, cachedGraphDatas, provider, selectedMarginAccount, setCachedGraphDatas, setGraphData]);

  // MARK: Fetch Uniswap positions for this MarginAccount (debounced to avoid double-fetching)
  useDebouncedEffect(
    () => {
      setIsLoadingUniswapPositions(true);
      const cachedUniswapPositions = cachedUniswapPositionsMap.get(selectedMarginAccount?.address ?? '');
      if (cachedUniswapPositions !== undefined) {
        // If we have cached positions, set them and return (no need to fetch)
        setUniswapPositions(cachedUniswapPositions);
        setIsLoadingUniswapPositions(false);
        return;
      }
      (async () => {
        if (!Array.isArray(uniswapPositionTicks)) {
          setCachedUniswapPositionsMap((prev) => {
            return new Map(prev).set(selectedMarginAccount?.address ?? '', []);
          });
          setIsLoadingUniswapPositions(false);
          return;
        }

        // Convert the ticks into UniswapPositionPriors
        const uniswapPositionPriors: UniswapPositionPrior[] = [];
        for (let i = 0; i < uniswapPositionTicks.length; i += 2) {
          uniswapPositionPriors.push({
            lower: uniswapPositionTicks[i] as number,
            upper: uniswapPositionTicks[i + 1] as number,
          });
        }
        if (uniswapPositionPriors.length === 0 || selectedMarginAccount === undefined) {
          setCachedUniswapPositionsMap((prev) => {
            return new Map(prev).set(selectedMarginAccount?.address ?? '', []);
          });
          setIsLoadingUniswapPositions(false);
          return;
        }

        // Fetch the positions
        const fetchedUniswapPositionsMap = await fetchUniswapPositions(
          uniswapPositionPriors,
          selectedMarginAccount.address,
          selectedMarginAccount.uniswapPool,
          provider,
          activeChain
        );
        // We only want the values, not the keys
        const fetchedUniswapPositions = Array.from(fetchedUniswapPositionsMap.values());

        // Cache the positions
        setCachedUniswapPositionsMap((prev) => {
          return new Map(prev).set(selectedMarginAccount.address, fetchedUniswapPositions);
        });
        // Set the positions
        setUniswapPositions(fetchedUniswapPositions);
        setIsLoadingUniswapPositions(false);
      })();
    },
    FETCH_UNISWAP_POSITIONS_DEBOUNCE_MS,
    [uniswapPositionTicks]
  );

  useEffect(() => {
    (async () => {
      if (userAddress === undefined) return;
      const fetchedUniswapNFTPositions = await fetchUniswapNFTPositions(userAddress, provider);
      setUniswapNFTPositions(fetchedUniswapNFTPositions);
    })();
  }, [provider, setUniswapNFTPositions, userAddress]);

  useEffect(() => {
    (async () => {
      if (!pendingTxn) return;
      setPendingTxnModalStatus(PendingTxnModalStatus.PENDING);
      setIsPendingTxnModalOpen(true);
      const receipt = await pendingTxn.wait();
      if (receipt.status === 1) {
        setPendingTxnModalStatus(PendingTxnModalStatus.SUCCESS);
      } else {
        setPendingTxnModalStatus(PendingTxnModalStatus.FAILURE);
      }
    })();
  }, [pendingTxn, setIsPendingTxnModalOpen, setPendingTxnModalStatus]);

  const { data: accountEtherBalanceResult } = useBalance({
    address: selectedMarginAccount?.address as Address,
    chainId: activeChain.id,
    watch: false,
    enabled: selectedMarginAccount !== undefined,
  });

  const accountEtherBalance = accountEtherBalanceResult && GN.fromBigNumber(accountEtherBalanceResult.value, 18);

  const filteredNonZeroUniswapNFTPositions = useMemo(() => {
    const filteredPositions: Map<number, UniswapNFTPosition> = new Map();
    if (selectedMarginAccount == null) return filteredPositions;
    uniswapNFTPositions.forEach((position, tokenId) => {
      if (
        selectedMarginAccount.token0.equals(position.token0) &&
        selectedMarginAccount.token1.equals(position.token1) &&
        GetNumericFeeTier(selectedMarginAccount.feeTier) === position.fee &&
        JSBI.greaterThan(position.liquidity, JSBI.BigInt('0'))
      ) {
        filteredPositions.set(tokenId, position);
      }
    });
    return filteredPositions;
  }, [selectedMarginAccount, uniswapNFTPositions]);

  const withdrawableUniswapNFTPositions = useMemo(() => {
    const filteredPositions: Map<number, UniswapNFTPosition> = new Map();
    if (selectedMarginAccount == null) return filteredPositions;
    uniswapPositions.forEach((uniswapPosition) => {
      const isNonZero = JSBI.greaterThan(uniswapPosition.liquidity, JSBI.BigInt('0'));
      const matchingNFTPosition = Array.from(uniswapNFTPositions.entries()).find(([, position]) => {
        return position.lower === uniswapPosition.lower && position.upper === uniswapPosition.upper;
      });
      if (matchingNFTPosition !== undefined && isNonZero) {
        filteredPositions.set(matchingNFTPosition[0], matchingNFTPosition[1]);
      }
    });
    return filteredPositions;
  }, [selectedMarginAccount, uniswapPositions, uniswapNFTPositions]);

  const defaultPool = Array.from(availablePools.keys())[0];

  const dailyInterest0 =
    ((selectedMarketInfo?.borrowerAPR0 || 0) / 365) * (selectedMarginAccount?.liabilities.amount0 || 0);
  const dailyInterest1 =
    ((selectedMarketInfo?.borrowerAPR1 || 0) / 365) * (selectedMarginAccount?.liabilities.amount1 || 0);

  const baseEtherscanUrl = getEtherscanUrlForChain(activeChain);
  const selectedMarginAccountEtherscanUrl = `${baseEtherscanUrl}/address/${selectedMarginAccount?.address}`;

  const hasLiabilities = Object.values(selectedMarginAccount?.liabilities ?? {}).some((liability) => {
    return liability > 0;
  });

  const accountHasEther = accountEtherBalance?.isGtZero() ?? false;

  const isUnableToWithdrawAnte = hasLiabilities || !accountHasEther;

  const userHasNoMarginAccounts = borrowerNftBorrowers?.length === 0;

  return (
    <AppPage>
      <ExplainerWrapper>
        <Text size='M' weight='regular' color={SECONDARY_COLOR}>
          When you borrow on the Markets page or Boost page, Borrower NFTs are created behind the scenes. This page
          gives you fine-grained control over those NFTs. However, once you make changes here, the NFTs won't show up
          elsewhere.
        </Text>
      </ExplainerWrapper>
      <Container>
        <SmartWalletsContainer>
          <Text size='M' weight='bold' color={BORROW_TITLE_TEXT_COLOR}>
            Borrower NFTs
          </Text>
          <SmartWalletsList>
            {borrowerNftBorrowers?.map((account) => (
              <SmartWalletButton
                token0={account.token0}
                token1={account.token1}
                tokenId={parseInt(account.tokenId.slice(-4), 16)}
                isActive={selectedMarginAccount?.address === account.address}
                onClick={() => {
                  // When a new account is selected, we need to update the
                  // selectedMarginAccount, selectedMarketInfo, and uniswapPositions
                  // setSelectedMarginAccount(account);
                  setSearchParams({ [SELECTED_MARGIN_ACCOUNT_KEY]: account.address });
                  setSelectedMarketInfo(cachedMarketInfos.get(account.address) ?? undefined);
                  setUniswapPositions(cachedUniswapPositionsMap.get(account.address) ?? []);
                }}
                key={account.address}
              />
            ))}
            <NewSmartWalletButton
              userHasNoMarginAccounts={userHasNoMarginAccounts}
              onClick={() => {
                setNewSmartWalletModalOpen(true);
              }}
            />
          </SmartWalletsList>
        </SmartWalletsContainer>
        <PageGrid>
          <MonitorContainer>
            <ManageAccountButtons
              onAddCollateral={() => {
                if (isConnected) setIsAddCollateralModalOpen(true);
              }}
              onRemoveCollateral={() => {
                if (isConnected) setIsRemoveCollateralModalOpen(true);
              }}
              onBorrow={() => {
                if (isConnected) setIsBorrowModalOpen(true);
              }}
              onRepay={() => {
                if (isConnected) setIsRepayModalOpen(true);
              }}
              onGetLeverage={() => {
                if (selectedMarginAccount != null) {
                  const primeAccountUrl = `${primeUrl()}borrow/account/${selectedMarginAccount.address}`;
                  window.open(primeAccountUrl, '_blank');
                }
              }}
              onWithdrawAnte={() => {
                if (isConnected) setIsWithdrawAnteModalOpen(true);
              }}
              isWithdrawAnteDisabled={isUnableToWithdrawAnte}
              isDisabled={!selectedMarginAccount}
            />
          </MonitorContainer>
          <GraphContainer>
            <div>
              {graphData && graphData.length > 0 ? (
                <BorrowGraph graphData={graphData} />
              ) : (
                <BorrowGraphPlaceholder $animate={!userHasNoMarginAccounts} />
              )}
              <div className='text-center opacity-50 pl-8'>
                <Text size='S' weight='regular' color={LABEL_TEXT_COLOR}>
                  <em>
                    IV comes from an on-chain oracle. It influences the current collateral factor, which impacts the
                    health of your account.
                  </em>
                </Text>
              </div>
            </div>
          </GraphContainer>
          <MetricsContainer>
            <BorrowMetrics
              marginAccount={selectedMarginAccount}
              dailyInterest0={dailyInterest0}
              dailyInterest1={dailyInterest1}
              uniswapPositions={uniswapPositions}
              userHasNoMarginAccounts={userHasNoMarginAccounts}
            />
          </MetricsContainer>
          <UniswapPositionsContainer>
            <UniswapPositionList
              borrower={selectedMarginAccount}
              uniswapPositions={uniswapPositions}
              withdrawableUniswapNFTs={withdrawableUniswapNFTPositions}
              setPendingTxn={setPendingTxn}
            />
          </UniswapPositionsContainer>
          <StatsContainer>
            <GlobalStatsTable marginAccount={selectedMarginAccount} marketInfo={selectedMarketInfo} />
          </StatsContainer>
          {selectedMarginAccount && (
            <LinkContainer>
              <InfoIcon width={16} height={16} />
              <Text size='S' color={BORROW_TITLE_TEXT_COLOR} className='flex gap-1 whitespace-nowrap'>
                <StyledExternalLink href={selectedMarginAccountEtherscanUrl} target='_blank'>
                  View this account on Etherscan
                </StyledExternalLink>
              </Text>
            </LinkContainer>
          )}
        </PageGrid>
      </Container>
      {availablePools.size > 0 && (
        <NewSmartWalletModal
          availablePools={availablePools}
          defaultPool={defaultPool}
          isOpen={newSmartWalletModalOpen}
          setIsOpen={setNewSmartWalletModalOpen}
          setPendingTxn={setPendingTxn}
        />
      )}
      {selectedMarginAccount && selectedMarketInfo && (
        <>
          <AddCollateralModal
            borrower={selectedMarginAccount}
            marketInfo={selectedMarketInfo}
            isLoadingUniswapPositions={isLoadingUniswapPositions}
            existingUniswapPositions={uniswapPositions}
            uniswapNFTPositions={filteredNonZeroUniswapNFTPositions}
            isOpen={isAddCollateralModalOpen}
            setIsOpen={setIsAddCollateralModalOpen}
            setPendingTxn={setPendingTxn}
          />
          <RemoveCollateralModal
            borrower={selectedMarginAccount}
            uniswapPositions={uniswapPositions}
            marketInfo={selectedMarketInfo}
            isOpen={isRemoveCollateralModalOpen}
            setIsOpen={setIsRemoveCollateralModalOpen}
            setPendingTxn={setPendingTxn}
          />
          <BorrowModal
            borrower={selectedMarginAccount}
            uniswapPositions={uniswapPositions}
            marketInfo={selectedMarketInfo}
            accountEtherBalance={accountEtherBalance}
            isOpen={isBorrowModalOpen}
            setIsOpen={setIsBorrowModalOpen}
            setPendingTxn={setPendingTxn}
          />
          <RepayModal
            marginAccount={selectedMarginAccount}
            uniswapPositions={uniswapPositions}
            isOpen={isRepayModalOpen}
            setIsOpen={setIsRepayModalOpen}
            setPendingTxn={setPendingTxn}
          />
          <WithdrawAnteModal
            borrower={selectedMarginAccount}
            accountEthBalance={accountEtherBalance}
            isOpen={isWithdrawAnteModalOpen}
            setIsOpen={setIsWithdrawAnteModalOpen}
            setPendingTxn={setPendingTxn}
          />
        </>
      )}
      <PendingTxnModal
        isOpen={isPendingTxnModalOpen}
        setIsOpen={(isOpen: boolean) => {
          setIsPendingTxnModalOpen(isOpen);
          if (!isOpen) {
            setPendingTxn(null);
          }
        }}
        txnHash={pendingTxn?.hash}
        onConfirm={() => {
          setIsPendingTxnModalOpen(false);
          setTimeout(() => {
            navigate(0);
          }, 100);
        }}
        status={pendingTxnModalStatus}
      />
    </AppPage>
  );
}
