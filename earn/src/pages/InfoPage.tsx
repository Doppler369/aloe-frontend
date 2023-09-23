import { Fragment, useContext, useEffect } from 'react';

import { ContractCallContext, Multicall } from 'ethereum-multicall';
import { ethers } from 'ethers';
import { factoryAbi } from 'shared/lib/abis/Factory';
import { lenderABI } from 'shared/lib/abis/Lender';
import { volatilityOracleAbi } from 'shared/lib/abis/VolatilityOracle';
import AppPage from 'shared/lib/components/common/AppPage';
import {
  ALOE_II_FACTORY_ADDRESS,
  ALOE_II_ORACLE_ADDRESS,
  MULTICALL_ADDRESS,
} from 'shared/lib/data/constants/ChainSpecific';
import { Q32 } from 'shared/lib/data/constants/Values';
import { GN, GNFormat } from 'shared/lib/data/GoodNumber';
import { useChainDependentState } from 'shared/lib/data/hooks/UseChainDependentState';
import { getEtherscanUrlForChain } from 'shared/lib/util/Chains';
import styled from 'styled-components';
import { Address, useProvider } from 'wagmi';

import { ChainContext } from '../App';
import { UNISWAP_POOL_DENYLIST } from '../data/constants/Addresses';
import { TOPIC0_CREATE_MARKET_EVENT } from '../data/constants/Signatures';
import { ContractCallReturnContextEntries, convertBigNumbersForReturnContexts } from '../util/Multicall';

type AloeMarketInfo = {
  lenders: [Address, Address];
  lenderSymbols: [string, string];
  lenderDecimals: [number, number];
  lenderRateModels: [Address, Address];
  lenderReserveFactors: [number, number];
  lenderTotalSupplies: [GN, GN];
  nSigma: string;
  iv: number;
  ltv: number;
  ante: GN;
};

type LenderInfo = {
  reserveFactor: number;
  rateModel: Address;
  symbol: string;
  decimals: number;
  totalSupply: GN;
};

const InfoTable = styled.table`
  border-collapse: collapse;
  border: 1px solid #e5e7eb;

  th,
  td {
    padding: 0.5rem;
    text-align: center;
    white-space: nowrap;
  }

  th,
  tr:not(:last-child) {
    border-bottom: 1px solid #e5e7eb;
  }

  td:first-child:not([rowspan]),
  td:nth-last-child(5):not([rowspan]) {
    border-left: 1px solid #e5e7eb;
    text-align: start;
  }

  a {
    text-decoration: underline;
  }
`;

export default function InfoPage() {
  const { activeChain } = useContext(ChainContext);
  const provider = useProvider({ chainId: activeChain.id });
  const [poolInfo, setPoolInfo] = useChainDependentState<Map<Address, AloeMarketInfo> | undefined>(
    undefined,
    activeChain.id
  );
  useEffect(() => {
    (async () => {
      const chainId = (await provider.getNetwork()).chainId;

      // Fetch all the Aloe II markets
      let logs: ethers.providers.Log[] = [];
      try {
        logs = await provider.getLogs({
          fromBlock: 0,
          toBlock: 'latest',
          address: ALOE_II_FACTORY_ADDRESS[chainId],
          topics: [TOPIC0_CREATE_MARKET_EVENT],
        });
      } catch (e) {
        console.error(e);
      }

      // Get all of the lender addresses from the logs
      const lenderAddresses = logs.map((log) => {
        return ethers.utils.defaultAbiCoder.decode(['address', 'address'], log.data);
      });

      // Get all of the pool addresses from the logs
      const poolAddresses = logs
        .map((e) => `0x${e.topics[1].slice(-40)}` as Address)
        .filter((addr) => {
          return !UNISWAP_POOL_DENYLIST.includes(addr.toLowerCase());
        });

      const multicall = new Multicall({
        ethersProvider: provider,
        multicallCustomContractAddress: MULTICALL_ADDRESS[chainId],
        tryAggregate: true,
      });

      // Get all of the lender info
      const lenderCallContexts: ContractCallContext[] = [];

      lenderAddresses
        .flatMap((addr) => addr)
        .forEach((addr) => {
          lenderCallContexts.push({
            reference: addr,
            contractAddress: addr,
            abi: lenderABI as any,
            calls: [
              {
                reference: 'reserveFactor',
                methodName: 'reserveFactor',
                methodParameters: [],
              },
              {
                reference: 'rateModel',
                methodName: 'rateModel',
                methodParameters: [],
              },
              {
                reference: 'symbol',
                methodName: 'symbol',
                methodParameters: [],
              },
              {
                reference: 'decimals',
                methodName: 'decimals',
                methodParameters: [],
              },
              {
                reference: 'totalSupply',
                methodName: 'totalSupply',
                methodParameters: [],
              },
            ],
          });
        });

      const lenderCallResults = (await multicall.call(lenderCallContexts)).results;

      // Lender address -> Lender info
      const lenderResults: Map<string, LenderInfo> = new Map();

      Object.entries(lenderCallResults).forEach(([key, value]) => {
        const updatedCallsReturnContext = convertBigNumbersForReturnContexts(value.callsReturnContext);
        const reserveFactor = (1 / updatedCallsReturnContext[0].returnValues[0]) * 100;
        const rateModel = updatedCallsReturnContext[1].returnValues[0] as Address;
        const symbol = updatedCallsReturnContext[2].returnValues[0] as string;
        const decimals = updatedCallsReturnContext[3].returnValues[0] as number;
        const totalSupply = GN.fromBigNumber(
          updatedCallsReturnContext[4].returnValues[0] as ethers.BigNumber,
          decimals
        );

        lenderResults.set(key, {
          reserveFactor,
          rateModel,
          symbol,
          decimals,
          totalSupply,
        });
      });

      // Get all of the pool info
      const poolCallContexts: ContractCallContext[] = [];

      poolAddresses.forEach((addr) => {
        poolCallContexts.push({
          reference: `${addr}-oracle`,
          contractAddress: ALOE_II_ORACLE_ADDRESS[chainId],
          abi: volatilityOracleAbi as any,
          calls: [
            {
              reference: 'consult',
              methodName: 'consult',
              methodParameters: [addr, Q32],
            },
          ],
        });
        poolCallContexts.push({
          reference: `${addr}-factory`,
          contractAddress: ALOE_II_FACTORY_ADDRESS[chainId],
          abi: factoryAbi as any,
          calls: [
            {
              reference: 'getParameters',
              methodName: 'getParameters',
              methodParameters: [addr],
            },
          ],
        });
      });

      const poolCallResults = (await multicall.call(poolCallContexts)).results;

      // Pool address -> Pool info
      const correspondingPoolResults: Map<string, ContractCallReturnContextEntries> = new Map();

      Object.entries(poolCallResults).forEach(([key, value]) => {
        const entryAccountAddress = key.split('-')[0];
        const entryType = key.split('-')[1];
        const existingValue = correspondingPoolResults.get(entryAccountAddress);
        if (existingValue) {
          existingValue[entryType] = value;
        } else {
          correspondingPoolResults.set(entryAccountAddress, { [entryType]: value });
        }
      });

      const poolInfoMap = new Map<Address, AloeMarketInfo>();
      poolAddresses.forEach((addr, i) => {
        const lender0 = lenderAddresses[i][0] as Address;
        const lender1 = lenderAddresses[i][1] as Address;
        const lender0Info = lenderResults.get(lender0)!;
        const lender1Info = lenderResults.get(lender1)!;
        const poolResult = correspondingPoolResults.get(addr);
        const oracleResult = convertBigNumbersForReturnContexts(poolResult?.oracle?.callsReturnContext ?? [])?.[0]
          .returnValues;
        const factoryResult = convertBigNumbersForReturnContexts(poolResult?.factory?.callsReturnContext ?? [])?.[0]
          .returnValues;
        const iv = (ethers.BigNumber.from(oracleResult[2]).div(1e12).toNumber() / 1e6) * Math.sqrt(365) * 100;
        const ltv = Math.max(0.0948, Math.min((1 - 5 * iv) / 1.055, 0.9005)) * 100;
        const nSigma = factoryResult[1] as string;
        const ante = GN.fromBigNumber(factoryResult[0], 18);
        poolInfoMap.set(addr, {
          lenders: [lender0, lender1],
          lenderSymbols: [lender0Info.symbol, lender1Info.symbol],
          lenderDecimals: [lender0Info.decimals, lender1Info.decimals],
          lenderRateModels: [lender0Info.rateModel, lender1Info.rateModel],
          lenderReserveFactors: [lender0Info.reserveFactor, lender1Info.reserveFactor],
          lenderTotalSupplies: [lender0Info.totalSupply, lender1Info.totalSupply],
          nSigma,
          iv,
          ltv,
          ante,
        });
      });
      setPoolInfo(poolInfoMap);
    })();
  }, [provider, setPoolInfo]);

  return (
    <AppPage>
      <InfoTable>
        <thead>
          <tr>
            <th>Uniswap Pool</th>
            <th>nSigma</th>
            <th>IV</th>
            <th>LTV</th>
            <th>Ante</th>
            <th>Lender</th>
            <th>Decimals</th>
            <th>Rate Model</th>
            <th>Reserve Factor</th>
            <th>Total Supply</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(poolInfo?.entries() ?? []).map(([addr, info]) => {
            return (
              <Fragment key={addr}>
                <tr>
                  <td rowSpan={2} className='font-mono'>
                    <a
                      href={`${getEtherscanUrlForChain(activeChain)}/address/${addr}`}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {addr.slice(0, 8)}...
                    </a>
                  </td>
                  <td rowSpan={2}>{info.nSigma}</td>
                  <td rowSpan={2}>{info.iv.toFixed(2)}%</td>
                  <td rowSpan={2}>{info.ltv.toFixed(2)}%</td>
                  <td rowSpan={2}>{info.ante.toString(GNFormat.LOSSY_HUMAN)} ETH</td>
                  <td>{info.lenderSymbols[0]}</td>
                  <td>{info.lenderDecimals[0]}</td>
                  <td className='font-mono'>
                    <a
                      href={`${getEtherscanUrlForChain(activeChain)}/address/${info.lenderRateModels[0]}`}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {info.lenderRateModels[0].slice(0, 8)}...
                    </a>
                  </td>
                  <td>{info.lenderReserveFactors[0].toFixed(1)}%</td>
                  <td>{info.lenderTotalSupplies[0].toString(GNFormat.LOSSY_HUMAN)}</td>
                </tr>
                <tr>
                  <td>{info.lenderSymbols[1]}</td>
                  <td>{info.lenderDecimals[1]}</td>
                  <td className='font-mono'>
                    <a
                      href={`${getEtherscanUrlForChain(activeChain)}/address/${info.lenderRateModels[1]}`}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {info.lenderRateModels[1].slice(0, 8)}...
                    </a>
                  </td>
                  <td>{info.lenderReserveFactors[1].toFixed(1)}%</td>
                  <td>{info.lenderTotalSupplies[1].toString(GNFormat.LOSSY_HUMAN)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </InfoTable>
    </AppPage>
  );
}