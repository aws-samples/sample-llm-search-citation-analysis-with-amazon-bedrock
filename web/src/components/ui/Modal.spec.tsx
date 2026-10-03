import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  modalElement, renderAlertModal, renderConfirmModal, renderModal
} from './Modal-fixtures';

describe('Modal', () => {
  beforeEach(() => {
    vi.spyOn(document, 'addEventListener');
    vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing when isOpen is false', () => {
    renderModal({ isOpen: false });
    
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders children when isOpen is true', () => {
    renderModal({ children: <p>Modal Content</p> });
    
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    renderModal({ title: 'Test Title' });
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop clicked', () => {
    const { onClose } = renderModal();

    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key pressed', () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides close button when showCloseButton is false', () => {
    renderModal({ showCloseButton: false });
    
    expect(screen.queryByLabelText('Close modal')).not.toBeInTheDocument();
  });

  it('applies correct size class for each size option', () => {
    const { rerender } = render(modalElement({ size: 'sm' }));
    expect(document.querySelector('dialog')).toHaveClass('max-w-sm');

    rerender(modalElement({ size: 'xl' }));
    expect(document.querySelector('dialog')).toHaveClass('max-w-xl');
  });

  it('sets body overflow to hidden when open', () => {
    renderModal();
    
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('removes keydown listener when unmounted', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderModal();
    
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

describe('ConfirmModal', () => {
  it('displays title and message', () => {
    renderConfirmModal({
      title: 'Confirm Delete',
      message: 'Are you sure?',
    });
    
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('calls onConfirm and onClose when confirm button clicked', () => {
    const {
      onClose, onConfirm 
    } = renderConfirmModal();
    
    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls only onClose when cancel button clicked', () => {
    const {
      onClose, onConfirm 
    } = renderConfirmModal();
    
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses custom button text when provided', () => {
    renderConfirmModal({
      title: 'Confirm Action',
      message: 'Proceed with action?',
      confirmText: 'Yes, proceed',
      cancelText: 'No, cancel',
    });
    
    expect(screen.getByText('Yes, proceed')).toBeInTheDocument();
    expect(screen.getByText('No, cancel')).toBeInTheDocument();
  });

  it('applies danger styling when confirmVariant is danger', () => {
    renderConfirmModal({
      title: 'Delete',
      message: 'Delete?',
      confirmVariant: 'danger',
    });
    
    const confirmButton = screen.getByText('OK');
    expect(confirmButton).toHaveClass('bg-red-600');
  });
});

describe('AlertModal', () => {
  it('displays title and message', () => {
    renderAlertModal({
      title: 'Success',
      message: 'Operation completed',
    });
    
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Operation completed')).toBeInTheDocument();
  });

  it('calls onClose when OK button clicked', () => {
    const { onClose } = renderAlertModal();
    
    fireEvent.click(screen.getByText('OK'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      variant: 'success',
      colourClass: 'text-emerald-600',
    },
    {
      variant: 'error',
      colourClass: 'text-red-600',
    },
  ] as const)('renders $variant icon with correct color when variant is $variant', ({
    variant, colourClass
  }) => {
    const { container } = renderAlertModal({ variant });
    
    const iconContainer = container.querySelector(`.${colourClass}`);
    expect(iconContainer).toBeInTheDocument();
  });
});
