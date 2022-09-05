import { Dropdown, DropdownOption } from '../../common/Dropdown';
import TokenAmountInput from '../../common/TokenAmountInput';
import { BaseActionCard } from '../BaseActionCard';
import { ActionCardProps, ActionProviders, DEFAULT_ACTION_VALUE, getDropdownOptionFromSelectedToken, parseSelectedToken, SelectedToken } from '../../../data/Actions';
import useEffectOnce from '../../../data/hooks/UseEffectOnce';

export function AloeBorrowActionCard(prop: ActionCardProps) {
  const { token0, token1, previousActionCardState, onRemove, onChange } = prop;
  const dropdownOptions: DropdownOption[] = [
    {
      label: token0?.ticker || '',
      value: SelectedToken.TOKEN_ZERO,
      icon: token0?.iconPath || '',
    },
    {
      label: token1?.ticker || '',
      value: SelectedToken.TOKEN_ONE,
      icon: token1?.iconPath || '',
    },
  ];
  const previouslySelectedToken = previousActionCardState?.aloeResult?.selectedToken || null;
  const selectedTokenOption = getDropdownOptionFromSelectedToken(previouslySelectedToken, dropdownOptions);
  const selectedToken = parseSelectedToken(selectedTokenOption.value);
  useEffectOnce(() => {
    if (!previouslySelectedToken) {
      onChange({
        aloeResult: {
          token0RawDelta: {
            numericValue: previousActionCardState?.aloeResult?.token0RawDelta?.numericValue || 0,
            inputValue: previousActionCardState?.aloeResult?.token0RawDelta?.inputValue || '',
          },
          token1RawDelta: {
            numericValue: previousActionCardState?.aloeResult?.token1RawDelta?.numericValue || 0,
            inputValue: previousActionCardState?.aloeResult?.token1RawDelta?.inputValue || '',
          },
          token0DebtDelta: {
            numericValue: previousActionCardState?.aloeResult?.token0DebtDelta?.numericValue || 0,
            inputValue: previousActionCardState?.aloeResult?.token0DebtDelta?.inputValue || '',
          },
          token1DebtDelta: {
            numericValue: previousActionCardState?.aloeResult?.token1DebtDelta?.numericValue || 0,
            inputValue: previousActionCardState?.aloeResult?.token1DebtDelta?.inputValue || '',
          },
          token0PlusDelta: DEFAULT_ACTION_VALUE,
          token1PlusDelta: DEFAULT_ACTION_VALUE,
          selectedToken: selectedToken,
        },
        uniswapResult: null,
      });
    }
  });
  let tokenAmount = '';
  if (previousActionCardState) {
    if (selectedTokenOption.value === dropdownOptions[0].value) {
      tokenAmount = previousActionCardState?.aloeResult?.token0DebtDelta.inputValue || '';
    } else {
      tokenAmount = previousActionCardState?.aloeResult?.token1DebtDelta.inputValue || '';
    }
  }
  
  return (
    <BaseActionCard
      action={ActionProviders.AloeII.actions.BORROW.name}
      actionProvider={ActionProviders.AloeII}
      onRemove={onRemove}
    >
      <div className='w-full flex flex-col gap-4 items-center'>
        <Dropdown
          options={dropdownOptions}
          selectedOption={selectedTokenOption}
          onSelect={(option) => {
            if (option.value !== selectedTokenOption.value) {
              onChange({
                aloeResult: {
                  token0RawDelta: DEFAULT_ACTION_VALUE,
                  token1RawDelta: DEFAULT_ACTION_VALUE,
                  token0DebtDelta: DEFAULT_ACTION_VALUE,
                  token1DebtDelta: DEFAULT_ACTION_VALUE,
                  token0PlusDelta: DEFAULT_ACTION_VALUE,
                  token1PlusDelta: DEFAULT_ACTION_VALUE,
                  selectedToken: parseSelectedToken(option.value),
                },
                uniswapResult: null,
              });
            }
          }}
        />
        <TokenAmountInput
          tokenLabel={selectedTokenOption.label || ''}
          value={tokenAmount}
          onChange={(value) => {
            const token0Change =
              selectedToken === SelectedToken.TOKEN_ZERO
                ? parseFloat(value) || null
                : null;
            const token1Change =
              selectedToken === SelectedToken.TOKEN_ONE
                ? parseFloat(value) || null
                : null;
            const token0IsSelected = selectedToken === SelectedToken.TOKEN_ZERO;
            onChange({
              aloeResult: {
                token0RawDelta: {
                  numericValue: token0Change || 0,
                  inputValue: token0IsSelected ? value : '',
                },
                token1RawDelta: {
                  numericValue: token1Change || 0,
                  inputValue: !token0IsSelected ? value : '',
                },
                token0DebtDelta: {
                  numericValue: token0Change || 0,
                  inputValue: token0IsSelected ? value : '',
                },
                token1DebtDelta: {
                  numericValue: token1Change || 0,
                  inputValue: !token0IsSelected ? value : '',
                },
                token0PlusDelta: DEFAULT_ACTION_VALUE,
                token1PlusDelta: DEFAULT_ACTION_VALUE,
                selectedToken: selectedToken,
              },
              uniswapResult: null,
            });
          }}
          max='100'
          maxed={tokenAmount === '100'}
        />
      </div>
    </BaseActionCard>
  );
}
